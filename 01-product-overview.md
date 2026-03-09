# Product Overview

## Product name

**mAIker**  
Meaning: **maker powered by AI**

## Product definition

mAIker is a local-first AI product engineering CLI that can:

- inspect an existing repository
- classify the requested task
- generate a plan
- route work to the correct model/agent
- implement code changes
- run deterministic validators
- run AI review on evidence
- repair failures with bounded retries
- escalate to humans when needed
- package final artifacts and reports

## Primary use cases

### 1. Responsive redesign
Example:
- make a web app mobile responsive
- preserve desktop behavior
- ensure navigation and tables work on small screens

### 2. Version upgrades
Example:
- upgrade Next.js / React / TypeScript / package versions
- re-test without breaking flows
- repair incompatibilities

### 3. Feature work
Example:
- add new product workflow
- implement forms
- preserve existing contracts

### 4. Targeted bugfix
Example:
- fix CTA overflow
- fix incorrect sticky navigation
- repair broken multi-step flow

## Product principles

1. **Deterministic evidence first**
   - build, lint, typecheck, tests, E2E, screenshots

2. **AI interpretation second**
   - AI reviews artifacts and checks product constraints

3. **Dynamic validation**
   - validator set is chosen by task + repo + policy

4. **Bounded autonomy**
   - retries are limited
   - repeated failures escalate to human review

5. **Observable execution**
   - user can see live stage, logs, artifacts, issues

6. **Controlled intervention**
   - user can pause, resume, inject context, request replan

## First release goal

Terminal-first release with:
- live logs
- run folders
- structured issues
- LangGraph orchestration
- Claude coding worker
- Playwright validation
- optional local UI later
