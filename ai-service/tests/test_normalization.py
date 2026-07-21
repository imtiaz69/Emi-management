import base64

from app.normalization import name_similarity, normalize_date, normalize_nid, normalize_text, parse_structured_payload


def test_bengali_digits_and_nid_normalization():
    assert normalize_nid("১২৩ ৪৫৬ ৭৮৯০") == "1234567890"


def test_name_normalization_and_similarity():
    assert normalize_text("Md.  Rahim Uddin") == "MD RAHIM UDDIN"
    assert name_similarity("MD RAHIM UDDIN", "Rahim Uddin Md") == 1.0


def test_date_normalization():
    assert normalize_date("15/05/1998") == "1998-05-15"


def test_supported_date_formats_normalize_to_iso():
    cases = {
        "31 Dec 2002": "2002-12-31",
        "31 December 2002": "2002-12-31",
        "31/12/2002": "2002-12-31",
        "31-12-2002": "2002-12-31",
        "2002-12-31": "2002-12-31",
        "৩১/১২/২০০২": "2002-12-31",
        "07 Jan 2002": "2002-01-07",
        "2002-01-07": "2002-01-07",
    }
    for value, expected in cases.items():
        assert normalize_date(value) == expected


def test_structured_qr_json():
    result = parse_structured_payload('{"name":"Md Rahim Uddin","nid":"1234567890","dob":"15/05/1998"}')
    assert result == {"name": "MD RAHIM UDDIN", "nidNumber": "1234567890", "dateOfBirth": "1998-05-15"}


def test_structured_qr_json_accepts_camel_case_field_names():
    result = parse_structured_payload('{"name":"Test Buyer","nidNumber":"1234567890","dateOfBirth":"1998-05-15"}')
    assert result == {"name": "TEST BUYER", "nidNumber": "1234567890", "dateOfBirth": "1998-05-15"}


def test_unstructured_payload_is_not_silently_accepted():
    assert parse_structured_payload("opaque-encrypted-data") == {}


def test_structured_qr_xml():
    raw = "<person><fullName>Test Buyer</fullName><nidNumber>1234567890</nidNumber><dateOfBirth>31 Dec 2002</dateOfBirth></person>"
    assert parse_structured_payload(raw) == {"name": "TEST BUYER", "nidNumber": "1234567890", "dateOfBirth": "2002-12-31"}


def test_structured_qr_url_and_percent_encoding():
    raw = "https://example.test/check?fullName=Test%20Buyer&nidNumber=1234567890&dateOfBirth=31%20Dec%202002"
    assert parse_structured_payload(raw) == {"name": "TEST BUYER", "nidNumber": "1234567890", "dateOfBirth": "2002-12-31"}


def test_structured_qr_key_value_and_bengali_digits():
    raw = "Name: Test Buyer|NID: ১২৩৪৫৬৭৮৯০|DOB: ৩১ Dec ২০০২"
    assert parse_structured_payload(raw) == {"name": "TEST BUYER", "nidNumber": "1234567890", "dateOfBirth": "2002-12-31"}


def test_structured_qr_positional_delimited_values():
    assert parse_structured_payload("Test Buyer|1234567890|31 Dec 2002") == {
        "name": "TEST BUYER", "nidNumber": "1234567890", "dateOfBirth": "2002-12-31"
    }


def test_structured_qr_base64_wrapped_json():
    encoded = base64.b64encode(b'{"name":"Test Buyer","nid":"1234567890","dob":"31 Dec 2002"}').decode()
    assert parse_structured_payload(encoded) == {"name": "TEST BUYER", "nidNumber": "1234567890", "dateOfBirth": "2002-12-31"}
