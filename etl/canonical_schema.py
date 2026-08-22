"""Canonical column mapping and cleaning helpers for DOL LCA disclosure files.

Source headers are ~identical across FY2024 Q1 - FY2026 Q3 except:
  - H_1B_DEPENDENT (FY2024 all quarters, FY2025 Q2+) vs H-1B_DEPENDENT (FY2025 Q1 only)
  - LAWFIRM_BUSINESS_FEIN, added FY2025 Q2 onward (not part of the canonical schema below,
    since it isn't needed for any of the search/company/role features)
"""
import datetime
import re

# canonical_field -> tuple of acceptable source column names (first match wins)
COLUMN_MAP = {
    "case_number": ("CASE_NUMBER",),
    "case_status": ("CASE_STATUS",),
    "received_date": ("RECEIVED_DATE",),
    "decision_date": ("DECISION_DATE",),
    "original_cert_date": ("ORIGINAL_CERT_DATE",),
    "visa_class": ("VISA_CLASS",),
    "job_title_raw": ("JOB_TITLE",),
    "soc_code": ("SOC_CODE",),
    "soc_title": ("SOC_TITLE",),
    "full_time_position": ("FULL_TIME_POSITION",),
    "begin_date": ("BEGIN_DATE",),
    "end_date": ("END_DATE",),
    "total_worker_positions": ("TOTAL_WORKER_POSITIONS",),
    "employer_name_raw": ("EMPLOYER_NAME",),
    "trade_name_dba": ("TRADE_NAME_DBA",),
    "employer_fein": ("EMPLOYER_FEIN",),
    "naics_code": ("NAICS_CODE",),
    "worksite_city": ("WORKSITE_CITY",),
    "worksite_county": ("WORKSITE_COUNTY",),
    "worksite_state": ("WORKSITE_STATE",),
    "worksite_postal_code": ("WORKSITE_POSTAL_CODE",),
    "wage_from": ("WAGE_RATE_OF_PAY_FROM",),
    "wage_to": ("WAGE_RATE_OF_PAY_TO",),
    "wage_unit": ("WAGE_UNIT_OF_PAY",),
    "prevailing_wage": ("PREVAILING_WAGE",),
    "pw_unit": ("PW_UNIT_OF_PAY",),
    "pw_wage_level": ("PW_WAGE_LEVEL",),
    "h1b_dependent": ("H_1B_DEPENDENT", "H-1B_DEPENDENT"),
    "willful_violator": ("WILLFUL_VIOLATOR",),
    "support_h1b": ("SUPPORT_H1B",),
}

ANNUALIZE_MULTIPLIER = {
    "Hour": 2080,
    "Week": 52,
    "Bi-Weekly": 26,
    "Month": 12,
    "Year": 1,
}

_WS_RE = re.compile(r"\s+")


def build_column_index(header):
    """Map canonical field -> column index for one file's header row."""
    index = {}
    for canonical, candidates in COLUMN_MAP.items():
        for cand in candidates:
            if cand in header:
                index[canonical] = header.index(cand)
                break
    missing = set(COLUMN_MAP) - set(index)
    if missing:
        raise ValueError(f"Header missing expected columns: {missing}")
    return index


def clean_text(v):
    if v is None:
        return None
    s = str(v).strip()
    return s if s else None


def normalize_job_title(raw):
    if raw is None:
        return None
    s = _WS_RE.sub(" ", raw.strip())
    return s.lower()


def normalize_soc_code(raw):
    s = clean_text(raw)
    if s is None:
        return None
    if "." not in s:
        s = f"{s}.00"
    return s


def parse_date(v):
    if v is None or v == "":
        return None
    if isinstance(v, datetime.datetime):
        return v.date()
    if isinstance(v, datetime.date):
        return v
    s = str(v).strip()
    if not s:
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y"):
        try:
            return datetime.datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def parse_numeric(v):
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(",", "").replace("$", "")
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def parse_int(v):
    n = parse_numeric(v)
    return int(n) if n is not None else None


def parse_bool_yn(v):
    s = clean_text(v)
    if s is None:
        return None
    return s.strip().upper().startswith("Y")


def annualize(amount, unit):
    if amount is None or not unit:
        return None
    mult = ANNUALIZE_MULTIPLIER.get(clean_text(unit))
    if mult is None:
        return None
    return round(amount * mult, 2)


def is_placeholder_fein(digits9):
    """True for classic dummy/example EINs (e.g. 12-3456789, 55-5555555) that
    unrelated filers reuse as a placeholder, which would otherwise merge
    completely unrelated employers together under one FEIN."""
    if len(set(digits9)) == 1:
        return True
    if digits9.endswith("000000"):
        return True
    # Any run of 6+ consecutive ascending or descending digits, anywhere in the
    # string (not just anchored at the start), e.g. the "987654" in 12-9876543.
    run = 1
    for i in range(1, len(digits9)):
        step = int(digits9[i]) - int(digits9[i - 1])
        if step in (1, -1) and (run == 1 or step == prev_step):
            run += 1
            prev_step = step
            if run >= 6:
                return True
        else:
            run = 1
            prev_step = step
    return False


def parse_fein(v):
    s = clean_text(v)
    if s is None:
        return None
    # A handful of rows carry obviously-junk placeholder text instead of a real EIN
    # (e.g. "Company or Organization Legal Name"); only accept the DOL EIN pattern.
    if re.fullmatch(r"\d{2}-?\d{7}", s.replace(" ", "")):
        digits = re.sub(r"\D", "", s)
        if is_placeholder_fein(digits):
            return None
        return f"{digits[:2]}-{digits[2:]}"
    return None
