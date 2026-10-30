# Security

Puritanical's hooks run on your machine in every agent session and write mode and config files, so a flaw in them matters.

Please report a vulnerability privately through this repository's private vulnerability reporting (Security tab, 'Report a vulnerability'), not in a public issue. Include the commit, the agent host, what you did and what you saw.

In scope: code execution or file writes beyond what the hooks and installers document, following a planted symlink, leaking prompt or project content, and rule text that tells an agent to weaken a security check.

Out of scope: the code an agent writes whilst using the rules. Puritanical guides the agent; it does not prove the change correct.
