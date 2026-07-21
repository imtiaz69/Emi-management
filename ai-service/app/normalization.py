import base64
import json
import re
import unicodedata
from datetime import datetime
from urllib.parse import parse_qs, unquote_plus, urlparse
from xml.etree import ElementTree

from dateutil import parser as date_parser
from rapidfuzz.fuzz import token_sort_ratio

BENGALI_DIGITS = str.maketrans("০১২৩৪৫৬৭৮৯", "0123456789")
ALIASES = {
    "name": {"name", "full name", "person name", "holder name", "নাম", "নাম নাম"},
    "nidNumber": {
        "nid", "nid no", "nid number", "nid card no", "national id", "national id no",
        "national identity number", "id no", "identity no", "জাতীয় পরিচয় পত্র নম্বর", "জাতীয় পরিচয় নম্বর"
    },
    "dateOfBirth": {"dob", "date of birth", "birth date", "birthdate", "date birth", "জন্ম তারিখ", "জন্মতারিখ"},
}
MAX_QR_TEXT_LENGTH = 16_384


def normalize_text(value: str | None) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).translate(BENGALI_DIGITS).upper()
    return re.sub(r"\s+", " ", re.sub(r"[^A-Z0-9\u0980-\u09FF]+", " ", text)).strip()


def normalize_nid(value: str | None) -> str:
    return re.sub(r"\D", "", normalize_text(value))


def normalize_date(value: str | None) -> str:
    if not value:
        return ""
    text = str(value).translate(BENGALI_DIGITS).strip()
    for day_first in (True, False):
        try:
            parsed = date_parser.parse(text, dayfirst=day_first, fuzzy=False)
            if 1900 <= parsed.year <= datetime.now().year:
                return parsed.date().isoformat()
        except (ValueError, OverflowError):
            pass
    return normalize_text(text)


def name_similarity(left: str | None, right: str | None) -> float:
    if not left or not right:
        return 0.0
    return round(token_sort_ratio(normalize_text(left), normalize_text(right)) / 100, 4)


def canonical_key(value: str) -> str | None:
    key = normalize_text(value).lower()
    compact_key = key.replace(" ", "")
    for canonical, aliases in ALIASES.items():
        if key in aliases or compact_key in {normalize_text(alias).lower().replace(" ", "") for alias in aliases | {canonical}}:
            return canonical
    return None


def flatten_mapping(value, output: dict) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            canonical = canonical_key(str(key))
            if canonical and not isinstance(item, (dict, list)):
                output[canonical] = str(item)
            flatten_mapping(item, output)
    elif isinstance(value, list):
        for item in value:
            flatten_mapping(item, output)


def flatten_xml(element, output: dict) -> None:
    canonical = canonical_key(element.tag.split("}")[-1])
    if canonical and element.text and element.text.strip():
        output[canonical] = element.text.strip()
    for key, value in element.attrib.items():
        canonical = canonical_key(key)
        if canonical:
            output[canonical] = value
    for child in element:
        flatten_xml(child, output)


def valid_base64_text(raw: str) -> str:
    compact = re.sub(r"\s+", "", raw)
    if len(compact) < 16 or not re.fullmatch(r"[A-Za-z0-9_+/=-]+", compact):
        return ""
    padded = compact + "=" * (-len(compact) % 4)
    for decoder in (base64.b64decode, base64.urlsafe_b64decode):
        try:
            decoded = decoder(padded).decode("utf-8").strip()
            if decoded and sum(character.isprintable() for character in decoded) / len(decoded) >= 0.95:
                return decoded
        except (ValueError, UnicodeDecodeError):
            continue
    return ""


def infer_positional_fields(raw: str, fields: dict) -> None:
    if not re.search(r"[|;\n]", raw):
        return
    values = [value.strip() for value in re.split(r"[|;\n]+", raw) if value.strip()]
    for value in values:
        normalized_nid = normalize_nid(value)
        normalized_date = normalize_date(value)
        if "nidNumber" not in fields and re.fullmatch(r"[০-৯0-9\s-]{10,25}", value) and 10 <= len(normalized_nid) <= 17:
            fields["nidNumber"] = normalized_nid
        elif "dateOfBirth" not in fields and re.fullmatch(r"\d{4}-\d{2}-\d{2}", normalized_date):
            fields["dateOfBirth"] = normalized_date
    if "name" not in fields:
        possible_names = [value for value in values if not re.search(r"\d", value.translate(BENGALI_DIGITS)) and len(normalize_text(value)) >= 3]
        if len(possible_names) == 1:
            fields["name"] = possible_names[0]


def parse_structured_payload(raw: str, depth: int = 0) -> dict:
    if not isinstance(raw, str) or not raw.strip() or len(raw) > MAX_QR_TEXT_LENGTH:
        return {}
    raw = raw.strip().lstrip("\ufeff")
    decoded_percent = unquote_plus(raw)
    if decoded_percent != raw:
        raw = decoded_percent
    fields: dict[str, str] = {}
    try:
        flatten_mapping(json.loads(raw), fields)
    except (json.JSONDecodeError, TypeError):
        pass

    if raw.startswith("<"):
        try:
            flatten_xml(ElementTree.fromstring(raw), fields)
        except ElementTree.ParseError:
            pass

    parsed_url = urlparse(raw)
    if parsed_url.scheme:
        for encoded_values in (parsed_url.query, parsed_url.fragment):
            for key, values in parse_qs(encoded_values).items():
                canonical = canonical_key(key)
                if canonical and values and canonical not in fields:
                    fields[canonical] = values[0]

    for segment in re.split(r"[\n;|,&]+", raw):
        match = re.match(r"\s*([^:=]+?)\s*[:=]\s*(.+?)\s*$", segment)
        if match:
            canonical = canonical_key(match.group(1))
            if canonical and canonical not in fields:
                fields[canonical] = match.group(2)

    infer_positional_fields(raw, fields)
    if not fields and depth < 2:
        decoded_base64 = valid_base64_text(raw)
        if decoded_base64 and decoded_base64 != raw:
            return parse_structured_payload(decoded_base64, depth + 1)
    return normalize_fields(fields)


def normalize_fields(fields: dict) -> dict:
    result = {key: str(value).strip() for key, value in fields.items() if value is not None}
    if "nidNumber" in result:
        result["nidNumber"] = normalize_nid(result["nidNumber"])
        if not 10 <= len(result["nidNumber"]) <= 17:
            result.pop("nidNumber")
    if "dateOfBirth" in result:
        result["dateOfBirth"] = normalize_date(result["dateOfBirth"])
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", result["dateOfBirth"]):
            result.pop("dateOfBirth")
    if "name" in result:
        result["name"] = normalize_text(result["name"])
        if not result["name"] or not re.search(r"[A-Z\u0980-\u09FF]", result["name"]):
            result.pop("name")
    return result
