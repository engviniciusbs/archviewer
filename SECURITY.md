# Security Policy

ArchViewer runs entirely in the browser and never sends code, paths or metrics to a server. A bug that breaks that promise is a security issue.

## Reporting a vulnerability

Please **do not open a public issue**. Report it privately through [GitHub Security Advisories](https://github.com/engviniciusbs/archviewer/security/advisories/new).

Include what you found, how to reproduce it and the impact you expect. You should get a reply within a week. Fixes are released from `main`, which is what runs at https://archviewer.viniciusbsarmento.com.

## In scope

- Anything that sends project contents or metadata off the user's machine
- Code execution or script injection through a crafted project (file names, file contents, `package.json`, `tsconfig.json`)
- The production site and its deployment pipeline
