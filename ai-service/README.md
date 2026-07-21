---
title: FinanceLend Identity Cross Validation
emoji: "shield"
colorFrom: green
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
license: apache-2.0
---

# FinanceLend Identity Cross-Validation

Private API used by the FinanceLend Node server to compare supplied NID OCR fields, legitimately decodable QR fields, an NID portrait, and a live capture. It does not query or represent the Bangladesh government.

Set `IDENTITY_AI_SERVICE_KEY` as a Hugging Face Space secret. The API intentionally disables interactive documentation and does not log requests.
