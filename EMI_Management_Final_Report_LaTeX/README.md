# FinanceLend Final Report (Overleaf)

This folder is a self-contained LaTeX project for the combined 4-1 and 4-2
final report.

The validated build is included as
`EMI_Management_and_Loan_Tracking_Final_Report_4-2_LaTeX.pdf`.

The 19 July 2026 revision documents the current Socket.IO notification
system, 25-test backend suite, 124-handler API, Stripe payment workflows,
professional server-generated documents, and refreshed desktop/mobile
evidence.

## Overleaf

1. Zip the contents of this folder.
2. In Overleaf, create a new project with **Upload Project**.
3. Select `main.tex` as the main document.
4. Use the **pdfLaTeX** compiler.
5. Compile at least twice so the contents, figure list, table list, and
   cross-references settle.

No shell escape, external font, or generated file outside this folder is
required.

The report uses the template-matched thesis style directly in `main.tex`:
11-point TeX Gyre Termes, 1.5 line spacing, symmetric A4 margins, indented
paragraphs, centered chapter openings, and centered hyphenated page numbers.

## Local build

With TeX Live:

```bash
latexmk -pdf main.tex
```

With Tectonic:

```bash
tectonic main.tex
```

Provider-assigned public URLs are intentionally not fabricated in the report.
