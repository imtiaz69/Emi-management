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

Private API used by the FinanceLend Node server to extract NID-front fields for profile comparison. The service also retains the optional officer-led QR, face, and liveness pipeline. It does not query or represent the Bangladesh government.

Deploy the Docker service on Render and set `IDENTITY_AI_SERVICE_KEY` to the same secret used by the Node API. The API intentionally disables interactive documentation and does not log requests.
