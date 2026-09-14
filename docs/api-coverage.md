# Jules API coverage

Baseline: Google’s experimental `v1alpha` source/session/activity documentation checked 14 September 2026. The machine-readable manifest is `api-coverage.json`; tool schemas are frozen in `tests/fixtures/tool-schemas.json`. Every tool has a mocked executor/HTTP contract test.

| Tool                       | Upstream operation / derivation                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| `jules_list_sources`       | GET sources; pageSize, pageToken, documented AIP-160 filter                              |
| `jules_get_source`         | GET canonical source                                                                     |
| `jules_resolve_repository` | Bounded list/get sources; structured GitHub owner/repo match; no guessed source ID       |
| `jules_create_session`     | POST sessions; prompt, title, source/branch context, requirePlanApproval, AUTO_CREATE_PR |
| `jules_list_sessions`      | GET sessions; pageSize/pageToken; no undocumented filter                                 |
| `jules_get_session`        | GET session; unknown future state/fields preserved                                       |
| `jules_delete_session`     | DELETE session; no claim that deletion cancels running work                              |
| `jules_send_message`       | POST session:sendMessage with prompt                                                     |
| `jules_approve_plan`       | POST session:approvePlan                                                                 |
| `jules_list_activities`    | GET session/activities; pageSize/pageToken and experimental createTime example parameter |
| `jules_get_activity`       | GET exact activity                                                                       |
| `jules_get_change_set`     | GET exact activity → selected artifacts[index].changeSet.gitPatch                        |
| `jules_gateway_info`       | Local authenticated public capabilities + caller’s verified principal only               |

## Context and resolution

Create accepts exactly one of `repository`, canonical `source`, or intentional `repositoryless=true`. Unknown/misspelled keys and inconsistent context are rejected. `repository` means exact owner/repo or exact HTTPS GitHub repository URL; canonical resources use `source`. The dedicated resolver additionally accepts a canonical resource. Default branch comes from reported source metadata; explicit branch is preserved exactly. Automatic approval defaults stay with Jules when requirePlanApproval is omitted. AUTO_CREATE_PR creates a PR, never merges it. It is not accepted for a repositoryless request.

GitHub owner/repo comparison is case-insensitive; dots and hyphens are supported. The resolver keeps Google’s returned canonical source name. It inspects all bounded pages even after a match, rejecting ambiguity instead of selecting the first. It has no persistent cache or per-repository allowlist. A resumed cursor cannot establish uniqueness in unvisited earlier pages; continuation results carry candidates and an explicit incomplete flag for human/agent canonical selection.

## Output and contract qualifications

Default lists return metadata and identify omitted fields; full-detail mode remains bounded. Patches include session/activity/artifact identity, base commit, content digest, total UTF-16 length, selected offset and next offset. Surrogate pairs are not split; a digest mismatch rejects stale continuation. An upstream event larger than the read ceiling cannot be fully fetched; the caller receives an explicit resource-limit error rather than a fabricated diff or false completed review.

`createTime` is shown in Google’s activity-list example but not its query-parameter table at inspection. It is passed through only when explicitly supplied and validated as a timestamp; treat upstream acceptance as experimental. Source filter is documented; session filter is not in this baseline and is therefore not invented.

No documented baseline operation is intentionally reduced to a launcher-only facade. Source connection, cancellation, pausing, restarting, account administration and GitHub PR merging are excluded because these operations are not documented Jules endpoints in the checked baseline. Credential administration exists only as an owner bootstrap operation outside MCP.

Reverified 14 September 2026 against the current sources, sessions and activities references. The 13-tool manifest remains complete for the agreed scope. Both documented source-name shapes and opaque source IDs are accepted. The `createTime` activity parameter remains marked experimental because it appears in an example but not the parameter table. No live Jules call was made.
