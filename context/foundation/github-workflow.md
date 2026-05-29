# GitHub Workflow: Issues and Project Board

This document describes the conventions for creating and maintaining GitHub issues and the Projects v2 board for GitGud.

---

## Project Board

**Project:** GitGud MVP  
**URL:** https://github.com/users/gos-tomek/projects/X (check `gh project list --owner gos-tomek` for exact URL)  
**Project ID:** `PVT_kwHOERqfPM4BY-xN`

---

## Custom Fields

Every issue on the board has four custom fields. All must be filled when creating or editing an issue.

| Field | Type | Field ID | Purpose |
|---|---|---|---|
| **Change ID** | Text | `PVTF_lAHOERqfPM4BY-xNzhUAtLo` | Short roadmap identifier, e.g. `F-01`, `S-03` |
| **Roadmap ID** | Text | `PVTF_lAHOERqfPM4BY-xNzhUAtMg` | Kebab-case slug from roadmap, e.g. `access-control-and-membership` |
| **Status** | Single-select | `PVTSSF_lAHOERqfPM4BY-xNzhUAs5E` | See Status Values below |
| **Stream** | Single-select | `PVTSSF_lAHOERqfPM4BY-xNzhUAtNY` | See Stream Values below |

### Status Values

| Value | Meaning |
|---|---|
| `proposed` | In backlog, not yet started |
| `ready` | Prerequisites met, can be picked up |
| `blocked` | Waiting on a dependency or external decision |
| `in-progress` | Actively being worked on |
| `in-review` | PR open, awaiting review |
| `done` | Deployed to production (option id `fe521554`) — set automatically by `deploy.yml` on successful deploy |
| `rejected` | Descoped or cancelled |

Default for new issues: **`proposed`**. Set to `ready` once all prerequisites in `roadmap.md` are done.

### Stream Values

| Value | Meaning |
|---|---|
| `A: Access & Membership` | Auth, roles, board membership flows |
| `B: GitHub Data & Profile` | GitHub OAuth, org data ingestion, contributor profiles |
| `C: Classification` | AI classification, enriched metrics |

---

## Issue Structure

### Title format

```
[Change ID] Brief description
```

Example: `[F-01] Access Control and Membership`

### Body template

```markdown
## Summary
One-paragraph description of what this change delivers and why.

## User Stories
- US-NN: <title>

## Dependencies
- [ ] #N (ID: change-id)
- [ ] #M (ID: change-id)

---
> **Roadmap ID:** `change-slug`  
> **Stream:** A / B / C  
> **Prerequisites:** F-01, S-02 (or "None")
```

### Dependencies section rules

- List every prerequisite issue as a GitHub task-list item: `- [ ] #N (ID: change-id)`
- This creates a native "tracked by" relationship visible in the GitHub UI sidebar
- If there are no prerequisites, write: `None — root foundation, no prerequisites.`
- Do NOT check off (`- [x]`) items manually — GitHub tracks this automatically when issues close

---

## Setting Custom Field Values (CLI)

Use `gh api graphql` to set field values programmatically.

**Text field (Change ID or Roadmap ID):**
```bash
gh api graphql -f query='
mutation {
  updateProjectV2ItemFieldValue(input: {
    projectId: "PVT_kwHOERqfPM4BY-xN"
    itemId: "<PVTI_...>"
    fieldId: "<field-id>"
    value: { text: "<value>" }
  }) { clientMutationId }
}'
```

**Single-select field (Status or Stream):**
```bash
# First, get the option ID for the value you want:
gh api graphql -f query='
query {
  node(id: "PVT_kwHOERqfPM4BY-xN") {
    ... on ProjectV2 {
      fields(first: 20) {
        nodes {
          ... on ProjectV2SingleSelectField {
            name
            options { id name }
          }
        }
      }
    }
  }
}'

# Then set:
gh api graphql -f query='
mutation {
  updateProjectV2ItemFieldValue(input: {
    projectId: "PVT_kwHOERqfPM4BY-xN"
    itemId: "<PVTI_...>"
    fieldId: "<field-id>"
    value: { singleSelectOptionId: "<option-id>" }
  }) { clientMutationId }
}'
```

**Get item IDs for all board items:**
```bash
gh api graphql -f query='
query {
  node(id: "PVT_kwHOERqfPM4BY-xN") {
    ... on ProjectV2 {
      items(first: 20) {
        nodes {
          id
          content { ... on Issue { number title } }
        }
      }
    }
  }
}'
```

---

## Board Ordering

Items on the board follow the dependency order from `context/foundation/roadmap.md` (the "At a glance" table). When reordering is needed, read the Prerequisites column from that file to determine the correct sequence.

To move a specific item, first fetch current PVTI item IDs (see "Get item IDs" query above), then reposition:

```bash
gh api graphql -f query='
mutation {
  updateProjectV2ItemPosition(input: {
    projectId: "PVT_kwHOERqfPM4BY-xN"
    itemId: "<item-to-move>"
    afterId: "<item-it-goes-after>"   # null = move to top
  }) { clientMutationId }
}'
```

---

## Creating a New Issue for a Roadmap Item

1. Get the roadmap item details from `context/foundation/roadmap.md`
2. Create the issue with the correct title and body (use the template above)
3. Add the issue to the project board: `gh project item-add <project-number> --owner gos-tomek --url <issue-url>`
4. Set **Change ID**, **Roadmap ID**, **Status**, and **Stream** fields via GraphQL
5. Set board position to match roadmap order via `updateProjectV2ItemPosition`
