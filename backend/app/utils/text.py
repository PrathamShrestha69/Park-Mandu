import re


def normalize_email(value: str) -> str:
    return value.strip().lower()


def normalize_phone(value: str) -> str:
    """Normalise Nepali mobile numbers to +977XXXXXXXXXX; other numbers keep digits and a leading +."""
    digits = re.sub(r"[^\d+]", "", value.strip())
    if digits.startswith("00"):
        digits = "+" + digits[2:]
    if re.fullmatch(r"9[78]\d{8}", digits):
        return "+977" + digits
    if re.fullmatch(r"977\d{10}", digits):
        return "+" + digits
    return digits


def looks_like_email(value: str) -> bool:
    return "@" in value


def escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
