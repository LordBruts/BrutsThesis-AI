# Changelog

## v2.0.0

A rebuild, not an upgrade. v1 is removed from the tree and kept in history.

### Why

v1's empirical review node was asked to report thirteen study attributes — design,
duration, location, sampling technique, sample size, instruments, data collection,
analysis method, findings, conclusions and the rest — for 10–15 studies, from an input
that contained only author, year, title, journal and DOI. No abstract, methods or results
text ever reached it. Every one of those fields had to be invented, and no prompt wording
can fix a node that has been given no facts.

### Added

- **`thesis-chapters/`** — the writer, as a typed sub-workflow. Plans queries, searches
  Europe PMC (`resultType=core`, which returns abstract, DOI, PMID, PMCID, publication
  types and the OA flag in one call), ranks and caps candidates, fetches verbatim Methods
  and Results from open-access full text, and only then writes.
- **Citation Gate** — citations are opaque markers resolved by a Code node against the
  fetched evidence; the reference list is computed from what was actually cited. An
  invented reference is unrepresentable.
- **`intake-delivery/`** — the front end, with two triggers: the Tally webhook, and
  polling of the sheet Tally writes into. The polling path needs no public tunnel.
- Departmental formatting guidelines applied per submission.
- Google Drive upload alongside the Gmail delivery.
- Error branches throughout, with failures recorded against the submission row.
- Unit tests over the real Code node sources, against captured fixtures.

### Changed

- Writers have no search tools and no memory. Their only input is the evidence pack.
- The reference list is computed, never written by a model.
- Credentials are attached in the n8n UI. The committed exports carry no credential
  blocks and no instance ids.

### Removed

- The v1 workflow export, its screenshots, its sample input and its installation guide.
  Recoverable from history.

---

## v1.0.0

### Added
- Automated proposal generation
- DOCX export
- Gmail delivery
- Google Sheets logging
- Tally integration
