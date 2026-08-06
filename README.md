# Bruts-Thesis AI

An AI-powered workflow that automates the generation of medical thesis proposals (Chapters 1–3) using n8n and Large Language Models.

The workflow collects project information through a Tally form, retrieves relevant academic literature, generates a structured proposal, delivers the proposal as a Microsoft Word document via email, and records the submission status in Google Sheets.

---

## Overview

Writing a medical thesis proposal is time-consuming and repetitive. This project automates much of the drafting process, allowing students to focus on reviewing, refining, and validating the generated content instead of writing every section from scratch.

The generated proposal is intended to serve as a high-quality first draft and should always be reviewed and edited by the user before submission.

---

## Features

- Collects thesis details through a Tally form
- Automates proposal generation using AI
- Generates Chapters 1–3
- Retrieves relevant academic literature
- Produces a formatted Microsoft Word document
- Sends the proposal automatically via Gmail
- Records submission status in Google Sheets
- Built as a reusable n8n workflow

---

## Workflow

```text
Tally Form
      │
      ▼
n8n Trigger
      │
      ▼
Validate User Input
      │
      ▼
Retrieve Academic Literature
      │
      ▼
Generate Proposal (Chapters 1–3)
      │
      ▼
Format as DOCX
      │
      ▼
Send via Gmail
      │
      ▼
Log Submission in Google Sheets
```

---

## Tech Stack

- n8n
- OpenRouter
- Tally Forms
- Gmail API
- Google Sheets

---

## Input

The workflow accepts project information submitted through a Tally form.

Typical inputs include:

- Research title
- Student information
- Institution
- Department
- Study location
- Additional project requirements

---

## Output

The workflow generates:

- A Microsoft Word (.docx) thesis proposal
- Chapters 1–3
- Email delivery to the requester
- Submission log stored in Google Sheets

---

## Use Case

Designed primarily for:

- Medical Radiography students
- Nursing students
- Medical Laboratory Science students
- Public Health students
- Other health-related programmes

---

## Project Status

🚧 In Development

Current progress:

- Core workflow implemented
- Proposal generation functional
- DOCX generation implemented
- Gmail delivery implemented
- Google Sheets logging implemented

Remaining work includes testing, refinement, documentation, and production hardening.

---

## Disclaimer

This project assists with drafting thesis proposals.

Users are responsible for:

- verifying factual accuracy
- reviewing citations
- complying with institutional guidelines
- ensuring academic integrity

The generated proposal should always undergo human review before submission.

---

## Repository Contents

This repository demonstrates the overall architecture and implementation of the Medical Thesis Proposal Writer.

To protect proprietary work, the following components are intentionally omitted or sanitized:

- AI system prompts
- Prompt engineering logic
- API credentials
- Sensitive workflow configuration
- Proprietary templates

The repository is intended to showcase the application's architecture, workflow design, and implementation approach.

---

## License

This project is licensed under the MIT License.
