# Your AI Companion

===============================================================

PROJECT: AI BUDDY

PRODUCT TYPE: AI-POWERED CHROME EXTENSION + WEB PLATFORM

BUILD MODE: PRODUCTION-ORIENTED MVP → EXTENSIBLE PLATFORM

===============================================================

You are acting as a senior product architect, UX designer,

full-stack engineer, Chrome Extension engineer, AI-agent engineer,

QA engineer, security engineer and DevOps engineer.

Your job is NOT to create a static demo.

Build a REAL, modular, scalable AI Buddy platform with a

Chrome Extension as the primary product.

The product should feel extremely simple to the user while

the internal architecture is extremely powerful.

===============================================================

1. FIRST RULE — INSPECT BEFORE BUILDING

===============================================================

Before implementing anything:

1. Inspect the current Lovable project.

2. Identify the existing stack.

3. Identify existing components.

4. Identify database/backend capabilities.

5. Identify authentication.

6. Identify available integrations.

7. Identify what can actually be implemented inside Lovable.

8. Identify Chrome Extension MV3 requirements.

9. Identify features requiring a separate extension package,

   backend, API, or external service.

10. Do NOT fake unavailable functionality.

Create:

/docs/PROJECT_ARCHITECTURE.md

/docs/IMPLEMENTATION_PLAN.md

/docs/FEATURE_REGISTRY.md

/docs/BUG_REGISTRY.md

/docs/SECURITY.md

/docs/TEST_PLAN.md

/docs/ROADMAP.md

Do not destroy working functionality.

===============================================================

2. PRODUCT VISION

===============================================================

AI Buddy is a voice-first intelligent browser companion.

It should understand:

"What is on my screen?"

"What am I doing?"

"What am I trying to achieve?"

"What should happen next?"

"Can I help?"

"Did the action actually succeed?"

It should be able to:

OBSERVE

UNDERSTAND

PLAN

ASK

ACT

VERIFY

RECOVER

EXPLAIN

The user should feel like they have an intelligent assistant

living inside Chrome.

===============================================================

3. CORE PRODUCT

===============================================================

Build:

A. Public Website

B. Authentication

C. User Dashboard

D. Buddy Selection

E. Custom Buddy Creator

F. Subscription/Plan architecture

G. Free Trial architecture

H. Chrome Extension

I. AI Orchestrator

J. Voice Engine

K. Screen Understanding Engine

L. Browser Agent

M. Memory System

N. Specialist Skills

O. Tool Registry

P. Workflow Engine

Q. Bug Detection Engine

R. Self-Debug Engine

S. Testing Engine

T. 3D Buddy/Animation System

U. Permission System

V. Security Layer

W. Feature Discovery System

X. Analytics/Logs

Y. Update/Version System

===============================================================

4. LANDING PAGE

===============================================================

Keep the interface extremely simple.

Hero:

"Meet Your AI Buddy."

Explain:

An intelligent AI companion that can understand your browser,

guide you, explain what you're seeing, and perform approved tasks.

Buttons:

TRY FREE

LOGIN

DOWNLOAD EXTENSION

Sections:

- How it works

- Features

- Specialist Buddies

- Voice Demo

- Browser Automation

- E-commerce

- CA

- Legal

- Developer

- Custom Buddy

- Security

- Pricing

- FAQ

Use modern premium UI.

Fast loading.

Responsive.

Dark/Light/System theme.

===============================================================

5. AUTHENTICATION

===============================================================

Implement:

- Sign up

- Login

- Logout

- Password reset

- Session handling

- User profile

- Plan status

- Free trial status

Do not store sensitive authentication secrets in frontend.

===============================================================

6. USER DASHBOARD

===============================================================

Dashboard should show:

Current Buddy

Current plan

Trial status

Recent tasks

Saved workflows

Memory

Skills

Tools

Usage

Settings

Permissions

Keep dashboard simple.

Advanced settings should remain hidden until requested.

===============================================================

7. BUDDY SELECTOR

===============================================================

Create beautiful Buddy gallery.

Initial Buddies:

CA Buddy

Legal Buddy

E-commerce Buddy

Developer Buddy

Business Buddy

Marketing Buddy

Research Buddy

Data Buddy

Content Buddy

Design Buddy

Operations Buddy

Professor Buddy

Dadaji Buddy

Detective Buddy

Friendly Buddy

All Buddies share the same core intelligence.

Differences:

- Expertise

- Personality

- Voice

- Humor

- Teaching style

- Animation

- Recommended skills

- Tool preferences

===============================================================

8. CUSTOM BUDDY CREATOR

===============================================================

User can create:

Name

Avatar

3D appearance

Voice

Language

Personality

Expertise

Humor level

Seriousness

Teaching style

Response style

Allowed tools

Permissions

Memory settings

Example:

"Create a strict but funny e-commerce expert who explains things

like a 20-year experienced professional."

Create the Buddy configuration automatically.

===============================================================

9. VOICE-FIRST SYSTEM

===============================================================

Support:

"Hey Buddy."

Commands:

"Buddy, what's happening?"

"Buddy, explain this."

"Buddy, click here."

"Buddy, open YouTube."

"Buddy, fill this form."

"Buddy, create this listing."

"Buddy, fix this error."

"Buddy, remember this."

"Buddy, repeat my previous workflow."

Voice must support:

- Speech-to-text

- Text-to-speech

- Streaming

- Interrupt

- Stop

- Resume

- Hindi

- English

- Hinglish

- Multiple voices

Wake-word functionality must respect browser/device limitations.

Provide push-to-talk fallback.

===============================================================

10. SCREEN UNDERSTANDING

===============================================================

Use available safe browser context:

DOM

Accessibility tree

Visible text

Page metadata

Current URL

Forms

Error messages

Screenshots when permitted

OCR when required

Identify:

buttons

forms

inputs

dropdowns

tables

images

warnings

errors

navigation

important fields

Buddy can highlight an element visually.

Example:

User:

"GSTIN कहाँ भरना है?"

Buddy:

"यह वाला field GSTIN के लिए है."

Then highlight the field.

===============================================================

11. UNIVERSAL BROWSER AGENT

===============================================================

Implement:

OPEN

NAVIGATE

CLICK

TYPE

SELECT

SCROLL

SEARCH

READ

EXTRACT

UPLOAD where permitted

DOWNLOAD where permitted

FILL

EDIT

VERIFY

Agent architecture:

OBSERVE

→ UNDERSTAND

→ PLAN

→ ACT

→ VERIFY

→ RECOVER

Never blindly click based only on coordinates.

Prefer:

DOM

Accessibility

Semantic selectors

Visual fallback

===============================================================

12. MULTI-STEP TASKS

===============================================================

Support:

"Open seller panel.

Create a listing.

Use these product details.

Fill all appropriate fields.

Optimize the content.

Check for missing fields.

Show me the final result.

Do not submit until I approve."

Agent should maintain a task state.

===============================================================

13. UNIVERSAL FORM ENGINE

===============================================================

Understand:

Label

Placeholder

Input type

Required status

Dropdown

Radio

Checkbox

Validation

Context

If information is unknown:

ASK.

Never invent important user-specific information.

Support reusable templates.

===============================================================

14. E-COMMERCE SUPER AGENT

===============================================================

Build specialist workflows for:

Product research

Listing creation

Title optimization

Description

Bullet points

Attributes

Keywords

SEO

Category selection

Image analysis

Image prompts

Catalog cleanup

Duplicate detection

SKU assistance

Inventory

Orders

Returns

Seller dashboards

Competitor research

Pricing analysis

Conversion optimization

Ad optimization

Campaign analysis

Listing quality scoring

Marketplace workflows

Example:

"Buddy, make this listing."

Buddy should:

Understand product

→ Research if necessary

→ Create content

→ Optimize

→ Fill form

→ Validate

→ Show summary

→ Ask before final high-impact submission

===============================================================

15. CA / ACCOUNTING SUPER AGENT

===============================================================

Support:

GST assistance

Invoice workflows

Accounting data organization

Reconciliation

Reports

Spreadsheet analysis

Registration assistance

Compliance checklists

Document preparation

Expense categorization

Data extraction

Form assistance

For current rules, use authoritative/current sources.

Never claim to be a licensed human professional.

===============================================================

16. LEGAL SUPER AGENT

===============================================================

Support:

Legal terminology explanation

Document drafting

Clause explanation

Document comparison

Registration assistance

Compliance checklists

Research

Document organization

Verify current laws and sources.

Do not fabricate legal citations.

===============================================================

17. DEVELOPER / CODER BUDDY

===============================================================

Create a dedicated coding agent.

Capabilities:

Repository inspection

Code search

Code explanation

Bug detection

Bug reproduction

Root cause analysis

Patch generation

Test generation

Testing

Refactoring

Optimization

Documentation

Dependency analysis

Security analysis

Regression detection

Rollback

Workflow:

INSPECT

→ REPRODUCE

→ DIAGNOSE

→ PATCH

→ TEST

→ REGRESSION TEST

→ REVIEW

→ APPLY

→ REPORT

===============================================================

18. MULTI-AI ORCHESTRATOR

===============================================================

Never hard-code the system to one AI provider.

Create an AIProvider abstraction.

Support configurable providers such as:

Google Gemini

OpenAI

xAI Grok

Anthropic Claude

Other compatible providers

Local/open-source models where practical

The user should see ONE Buddy.

Behind the scenes the system may select different models.

Routing factors:

Task type

Reasoning complexity

Vision requirement

Speed

Cost

Context size

Availability

Rate limits

Current information requirement

===============================================================

19. MULTI-MODEL CROSS CHECK

===============================================================

For important tasks:

Model A → analysis

Model B → independent analysis

Model C → review

Orchestrator compares:

Agreement

Contradictions

Evidence

Confidence

Freshness

Do not blindly combine answers.

===============================================================

20. PROVIDER FALLBACK

===============================================================

If primary AI fails:

Try configured fallback.

Handle:

Timeout

Rate limit

Network failure

Provider outage

Invalid response

Authentication failure

Never expose raw technical errors unnecessarily.

===============================================================

21. MEMORY

===============================================================

Create hybrid memory.

Store only appropriate information.

Possible memory:

Preferences

Work preferences

Buddy preferences

Non-sensitive business context

Product templates

Workflows

Writing style

Approved repeated workflows

Never store:

Passwords

OTP

PIN

CVV

Private keys

Authentication secrets

Memory controls:

View

Search

Edit

Forget

Export

Clear

===============================================================

22. TEACH & REPLAY

===============================================================

User:

"Buddy, watch this."

Buddy observes an approved workflow.

Later:

"Repeat that workflow."

Do not blindly replay coordinates.

Re-identify elements.

Adapt to layout changes.

Verify every important step.

Stop if uncertain.

===============================================================

23. SELF-DEBUG ENGINE

===============================================================

When a task fails:

DETECT

→ DIAGNOSE

→ FIND ROOT CAUSE

→ TRY SAFE RECOVERY

→ VERIFY

→ RETRY WITH LIMIT

→ ASK USER IF REQUIRED

Never create infinite retry loops.

===============================================================

24. AUTO BUG FIXER

===============================================================

Create BUG AUTOPILOT.

Automatically classify:

UI

UX

AI

API

Browser

DOM

Voice

Memory

Security

Performance

Automation

Animation

Integration

Regression

For every bug create:

ID

Severity

Reproduction

Expected

Actual

Root cause

Fix

Tests

Status

Priority:

P0 Critical

P1 High

P2 Medium

P3 Low

===============================================================

25. AUTOMATIC TESTING

===============================================================

Before considering any feature complete:

Run:

Unit tests

Integration tests

UI tests

Browser tests

Agent tests

Regression tests

Security checks

Create local test scenarios for:

Forms

Dynamic pages

Slow pages

Errors

Popups

Dropdowns

Changed layouts

Missing fields

Multi-step workflows

===============================================================

26. SELF-HEALING DEVELOPMENT LOOP

===============================================================

If tests fail:

READ FAILURE

→ IDENTIFY ROOT CAUSE

→ CREATE FIX

→ RUN TEST

→ RUN REGRESSION

→ IF PASS: KEEP FIX

→ IF FAIL: REVERT PATCH

→ TRY ALTERNATIVE

→ REPORT

Never overwrite stable functionality without a recovery point.

===============================================================

27. VERSION / ROLLBACK

===============================================================

Before major changes:

Create checkpoint.

Support:

Version history

Change summary

Rollback

Restore

===============================================================

28. DAILY FEATURE DISCOVERY

===============================================================

Create an optional daily intelligence system.

Discover:

New AI models

New AI tools

New APIs

Browser capabilities

Automation tools

E-commerce tools

CA tools

Legal tools

Developer tools

Marketing tools

Research tools

For every discovery:

Name

Category

Usefulness

Cost

Free alternative

Privacy

Risk

Integration difficulty

Expected benefit

Pipeline:

DISCOVER

→ EVALUATE

→ SCORE

→ PROPOSE

→ TEST

→ APPROVE

→ IMPLEMENT

→ REGRESSION TEST

Never automatically install arbitrary code.

===============================================================

29. SKILL SYSTEM

===============================================================

Build reusable Skills.

Examples:

create_listing

optimize_listing

analyze_ads

generate_report

fill_registration

analyze_spreadsheet

reconcile_data

debug_code

research_topic

generate_document

analyze_product

optimize_campaign

New Skills should be addable without modifying the core engine.

===============================================================

30. TOOL REGISTRY

===============================================================

Create centralized tool registry.

Tools:

Browser

Search

Vision

OCR

Files

PDF

Spreadsheet

Calculator

Code tools

Image generation

Document generation

Email

Calendar

Cloud storage

Databases

E-commerce APIs

Accounting APIs

CRM

Marketing APIs

Every tool must define:

Capabilities

Input

Output

Permissions

Risk

Provider

Cost

Fallback

===============================================================

31. PERMISSION SYSTEM

===============================================================

Create:

OBSERVE

EXPLAIN

SUGGEST

ASSIST

EXECUTE

APPROVED WORKFLOW

User can change permissions.

High-impact operations should require confirmation according

to configured policy.

Never bypass browser security controls.

===============================================================

32. 3D / ANIMATION SYSTEM

===============================================================

Buddy should feel alive.

Animations:

Idle

Walk

Run

Think

Listen

Speak

Point

Search

Confused

Curious

Concerned

Happy

Celebrate

Sleep

Wake

Waiting

Error

Success

Use lightweight rendering.

Create LOW / BALANCED / HIGH graphics modes.

===============================================================

33. EMOTION ENGINE

===============================================================

Tie animation and dialogue to task state.

Examples:

Starting:

"चलो, शुरू करते हैं."

Thinking:

"एक सेकंड, मैं check कर रही हूँ."

Problem:

"हम्म... यहाँ कुछ बदल गया है."

Recovery:

"रुको, दूसरा रास्ता मिल गया."

Success:

"Done! एक बार verify भी कर लेते हैं."

Uncertainty:

"इस information पर मैं sure नहीं हूँ—तुमसे पूछ लेती हूँ."

Do not use manipulative emotional behavior.

===============================================================

34. PERFORMANCE

===============================================================

Optimize for low-end laptops.

Use:

Lazy loading

Caching

Streaming

Background processing

Debouncing

Throttling

Minimal DOM observation

Minimal screenshot frequency

Efficient animations

Avoid unnecessary AI calls.

===============================================================

35. ANTI-HANG WATCHDOG

===============================================================

Every task gets:

Timeout

Cancellation

Retry limit

Watchdog

Recovery

State persistence

If Buddy becomes stuck:

Explain

Retry

Alternative

Ask user

Never silently freeze.

===============================================================

36. CONTEXT MANAGER

===============================================================

Do NOT send the entire browser history to every AI request.

Only send relevant:

Current task

Screen context

Relevant memory

Relevant specialist knowledge

Previous actions required for continuity

===============================================================

37. DEVELOPER CONTROL CENTER

===============================================================

Create simple developer interface.

Actions:

Run tests

Find bugs

Fix bugs

Inspect logs

Check AI providers

Add Buddy

Add Skill

Add Tool

Update feature

Rollback

Run security check

Run performance check

Generate changelog

Developer should be able to use natural language commands.

===============================================================

38. ONE-CLICK DIAGNOSTICS

===============================================================

Command:

"Buddy, diagnose yourself."

Return:

Extension health

Backend health

AI provider health

Tool health

Memory health

Permission health

Performance

Recent errors

Recommended fixes

===============================================================

39. SECURITY

===============================================================

Implement:

Least privilege

Secure storage

Sensitive field detection

Secret masking

CSP

Input validation

Authentication security

API key protection

Audit logs

Data deletion

Permission auditing

Never expose secrets to AI models unnecessarily.

===============================================================

40. PRIVACY

===============================================================

Provide:

Privacy Mode

Screen capture indicator

Memory controls

Data retention controls

Provider selection

Local processing where practical

Make it obvious when Buddy is observing or acting.

===============================================================

41. FEATURE REGISTRY

===============================================================

Maintain:

FEATURES.md

Each feature:

Name

Category

Status

Version

Dependencies

Tests

Known bugs

Performance impact

Security impact

===============================================================

42. BUG REGISTRY

===============================================================

Maintain:

BUGS.md

Update automatically when bugs are found.

Never delete bug history without explicit instruction.

===============================================================

43. CHANGELOG

===============================================================

Maintain:

CHANGELOG.md

For every update:

Added

Changed

Fixed

Security

Performance

Known limitations

===============================================================

44. AI SELF-IMPROVEMENT

===============================================================

When user says:

"Improve Buddy."

AI should:

Inspect project

Inspect bugs

Inspect tests

Inspect feature backlog

Inspect available tools

Propose improvements

Rank improvements

Implement in safe environment

Run tests

Run regression tests

Generate changelog

Request approval where required

Do NOT silently rewrite the entire project.

===============================================================

45. SIMPLE USER EXPERIENCE

===============================================================

The user interface must remain minimal.

User should primarily see:

Buddy

Voice

Text

Task status

Stop

Permission indicator

Everything else should be accessible through simple menus.

Complexity belongs inside the engine.

===============================================================

46. LOW-COST / FREE-FIRST

===============================================================

Design the AI layer so that the product can use free/low-cost

AI providers when available.

Never hard-code assumptions about "free forever".

Provider pricing and limits can change.

Make providers configurable.

===============================================================

47. EXTENSION ARCHITECTURE

===============================================================

Chrome Extension should be modular.

Recommended separation:

Extension UI

Content scripts

Background/service worker

Permission manager

Browser action layer

Context collector

Agent controller

AI gateway

Backend

Memory service

Tool service

Follow Chrome Extension Manifest V3 requirements.

Do not request unnecessary permissions.

===============================================================

48. IMPORTANT CHROME LIMITATION

===============================================================

Do not claim that an extension has unrestricted access to

every Chrome internal page.

Respect:

chrome:// pages

browser security boundaries

extension pages

permission restrictions

site restrictions

CAPTCHA

authentication boundaries

payment/security confirmations

When blocked, explain why.

===============================================================

49. PRODUCT QUALITY

===============================================================

Never mark a feature "complete" merely because the UI exists.

Feature is COMPLETE only when:

UI exists

Backend exists where needed

Real logic exists

Error handling exists

Permissions exist

Tests pass

Regression tests pass

Documentation exists

===============================================================

50. BUILD EXECUTION

===============================================================

START WITH:

PHASE 0:

Repository/project inspection.

PHASE 1:

Architecture + database + authentication + dashboard.

PHASE 2:

Chrome Extension foundation.

PHASE 3:

Buddy UI + voice.

PHASE 4:

Screen understanding.

PHASE 5:

Browser agent.

PHASE 6:

Universal forms + workflows.

PHASE 7:

AI Orchestrator + multiple providers.

PHASE 8:

Specialist Buddies + Skills.

PHASE 9:

Memory + Teach & Replay.

PHASE 10:

Self-debug + automated testing.

PHASE 11:

3D animation + emotion engine.

PHASE 12:

Security + performance.

PHASE 13:

Daily AI discovery + update system.

===============================================================

51. IMPORTANT IMPLEMENTATION RULE

===============================================================

DO NOT try to hide technical limitations.

DO NOT create fake buttons.

DO NOT create fake AI responses.

DO NOT hard-code fake browser automation.

DO NOT pretend a task succeeded unless it was verified.

DO NOT silently collect sensitive information.

DO NOT expose API keys.

DO NOT create uncontrolled self-modifying code.

===============================================================

52. DEVELOPMENT LOOP

===============================================================

For every implementation task:

PLAN

→ IMPLEMENT

→ TEST

→ FIND BUGS

→ FIX

→ REGRESSION TEST

→ DOCUMENT

→ CHECKPOINT

Then continue.

===============================================================

53. FINAL COMMAND

===============================================================

Start by inspecting the current Lovable project.

Do not immediately generate hundreds of files.

First create the architecture and identify the smallest

REAL working vertical slice.

Then implement that slice completely.

After each phase report:

COMPLETED

TESTED

BUGS FOUND

BUGS FIXED

KNOWN LIMITATIONS

NEXT PHASE

Build AI Buddy as a real product, not a visual mockup.

The final experience should be:

FAST

SMART

VOICE-FIRST

HELPFUL

MULTI-AI

MULTI-SKILL

MULTI-BUDDY

AUTOMATED

SELF-DIAGNOSTIC

SELF-TESTING

EASY TO UPDATE

LOW RESOURCE

SECURE

EXTENSIBLE

START.Now inspect your implementation against the entire master specification.

Find every missing feature, broken flow, architectural weakness,

security issue, performance issue and potential bug.

Do not just list them.

Create a prioritized FIX PLAN and implement the highest-value

safe fixes.

Run tests after every group of changes.Perform a senior-level adversarial QA audit of the entire AI Buddy

project.

Try to break every important workflow.

Test:

authentication

extension communication

voice

screen understanding

browser actions

forms

AI provider failures

memory

permissions

security

animations

performance

error recovery

multi-step tasks

regression

For every failure:

reproduce → diagnose → fix → test → regression test.

Do not report a bug as fixed until the test passes.Now perform a production-readiness audit.

Do not add cosmetic features first.

Prioritize:

reliability

security

privacy

performance

Chrome MV3 compatibility

AI provider fallback

error recovery

testing

observability

maintainability

Fix critical issues first.

Then implement the highest-value missing features.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/142f3fbd-6878-42b4-9fe5-1517e2fe8f28).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
