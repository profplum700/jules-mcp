# ADR 0002: Preserve a hard dependency-validation gate

Status: resolved on 14 September 2026. Genuine dependency installation, lockfile generation and full local validation now pass. The following records the original blocker and why it was not papered over.

The implementation sandbox has Node/Git/files but cannot resolve the package registry. Official source manifests provide exact direct version candidates, not verified published packages or a solved transitive graph. Constructing a plausible pnpm lockfile or reporting unexecuted Worker tests as passing would destroy reproducibility and conceal the most important integration risks.

Therefore the delivery omits a fabricated lockfile, provides executable dependency-free core tests, and includes a one-time no-secret bootstrap workflow. That workflow resolves real packages, formats source, runs all full checks and exports a patch for review; it cannot push, merge or deploy. Normal CI and production deployment require the reviewed lockfile and successful full checks.

This means the delivered source is not yet deploy-ready. Dependency/API incompatibilities found during bootstrap remain engineering work, not merely human authentication. Once the graph and full checks pass, commit the actual lockfile, remove this temporary gate from the outstanding-work list and continue the separate Stage-0 account/Free-performance trial. Do not replace the selected current stateless architecture with a deprecated template just to obtain a quick green run.
