# Teamwork Project Prompt — Draft

> Status: Ready for launch — awaiting user approval  
> Goal: Comprehensive Documentation & Architectural Communication Overhaul  
> Requested team: Documentation & Architectural Communication Team (Lead Architect, Frontend/Docs Engineer, Technical Writer, UX Juror)

ConvoLink is an intelligence, context, and capability bridge connecting upstream web AI conversations to local autonomous coding agents. Conduct a comprehensive documentation and architectural communication overhaul across both `README.md` and the `website/` documentation site: restore deep narrative context, integrate Mermaid diagram rendering, expand technical guides, and verify visual quality.

Working directory: `/home/tanzim/project/tools/agent_conversation`  
Integrity mode: `development`

---

## Requirements

### R1. Root `README.md` Restoration & Technical Depth
Restore and enhance the core architectural narrative that defines ConvoLink's value proposition:
- Restore `The Dual Problem`: "The Context Bottleneck: The Human Context-Relay Trap" and "The Intelligence & Cost Bottleneck: Local Agents Have Limited Capacity".
- Include the "Developer as Human Context Courier" vs "Connected Engineering Loop" visual flowcharts.
- Re-introduce the "Upstream Capability Borrowing Matrix" (Extended Thinking, Live Web Search Grounding, Deep Research, Multi-Model Consensus).
- Significantly upgrade `Path B: Direct CDP Remote Debugging` with clear, robust instructions for Chrome 144+ user-consented debugging (`chrome://inspect/#remote-debugging`), dynamic `DevToolsActivePort`, persistent AI profile, and `./scripts/fedora-chrome-debug.sh`.
- Keep verified metrics intact: 286 automated tests (100%), v1.0.0 release links, and documentation site links.

### R2. Documentation Site Mermaid Plugin Integration
Enable first-class Mermaid diagram rendering across the Astro Starlight documentation site:
- Integrate `astro-mermaid` and `mermaid` packages in `website/astro.config.mjs`.
- Ensure all flowchart and sequence diagrams in `.mdx` files render as interactive, theme-responsive SVG diagrams.
- Verify zero build warnings or hydration mismatch errors.

### R3. Comprehensive Documentation Site Expansion
Expand the documentation site in `website/src/content/docs/` with deep technical pages:
- Add `architecture/adr.mdx` summarizing key Architecture Decision Records (ADR-001 to ADR-017).
- Add `getting-started/linux-setup.mdx` detailing Linux (`tmpfs`, XDG runtime, Fedora script, permissions).
- Expand `commands/overview.mdx` with complete flag matrices, environment variables, and exit codes.
- Expand `getting-started/browser-connection.mdx` with deep step-by-step walkthroughs of all 4 connection tiers.

### R4. Anti-Slop Visual & Interaction Verification
Audit the documentation site visually using local preview and browser automation:
- Verify that Elysia-inspired glowing gradient styling looks sharp on dark canvas with high contrast.
- Verify that Mermaid diagrams render cleanly without horizontal overflow.
- Ensure all navigation links, breadcrumbs, search (`Ctrl+K`), and copy buttons work flawlessly.

### R5. Automated CI/CD & GitHub Pages Synchronization
- Ensure `bun run build:docs` builds all pages cleanly under 3 seconds.
- Verify `.github/workflows/deploy-docs.yml` deploys updated static assets to `https://0xtanzim.github.io/convolink/`.

---

## Acceptance Criteria

### Narrative & Technical Rigor
- [ ] `README.md` clearly conveys the Human Context-Relay Trap, the Intelligence Bottleneck, and the Upstream Capability Borrowing Matrix without empty buzzwords.
- [ ] `Path B: Direct CDP Remote Debugging` thoroughly explains Chrome 144+ consent, persistent AI profiles, and `./scripts/fedora-chrome-debug.sh`.
- [ ] Both Companion Extension (Path A) and Direct CDP (Path B) are exhaustively documented with troubleshooting guidance.

### Documentation Site & Diagram Integrity
- [ ] Mermaid diagrams render as crisp SVG graphics in the documentation site (not raw text blocks).
- [ ] `astro-mermaid` is properly registered in `website/astro.config.mjs`.
- [ ] `website/` builds 100% cleanly (`bun run build:docs`) with zero errors.
- [ ] Documentation site includes ADR summaries, Linux environment setup, and complete command references.

### Quality & Operational Gates
- [ ] `bun run typecheck` passes with 0 errors.
- [ ] `bun test` passes 100% (286 tests, 0 failures).
- [ ] Pushed to GitHub and deployed successfully to GitHub Pages.
