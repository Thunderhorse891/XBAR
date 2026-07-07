# XBAR Records: Phase 1 Build Spec

## Goal

Phase 1 is the point where XBAR stops being a strong single-browser product demo and starts becoming a real shared SaaS foundation.

The goal is not to build every feature.

The goal is to make the revenue wedge operational:

- trusted horse records
- real ownership persistence
- durable document and media storage
- authenticated user access
- reliable product data shared across sessions and users

## Phase 1 Outcome

When Phase 1 is complete, XBAR should support:

- real user accounts
- authenticated sessions
- server-backed horse records
- server-backed ownership records
- server-backed document metadata
- durable media and document storage
- audit-grade write history
- a safe transition from demo mode to shared mode

## Product Scope

Phase 1 covers:

1. Database foundation
2. Authentication foundation
3. Object/file storage foundation
4. Shared data layer for horses, ownership, and documents
5. Audit trail foundation

Phase 1 does not yet require:

- full OCR provider integration
- full billing integration
- full role-based entitlement enforcement
- polished external portal auth flows
- CRM depth

## Product Principle

Preserve the current public preview while building the real backend path.

That means:

- keep the demo mode working
- add a real shared mode behind a service layer
- avoid breaking GitHub Pages preview during the transition

## Architecture Direction

## Runtime Modes

Use two modes:

### 1. Demo mode

Used for:

- GitHub Pages preview
- offline demos
- safe public product walkthroughs

Behavior:

- current local persisted store can remain available
- no secrets required
- clearly treated as preview/demo mode

### 2. Shared mode

Used for:

- real product accounts
- authenticated operators
- durable records
- real uploads and collaboration

Behavior:

- app reads and writes through a server-backed API
- auth, storage, and persistence are enforced

## Data Strategy

The frontend should not write business truth directly to local state forever.

Instead:

- local store becomes a view/cache layer
- data actions move behind service functions
- service functions can call demo adapters or shared adapters

## Recommended Phase 1 Tech Direction

### App shell

Keep:

- React
- TypeScript
- Vite
- current routing and UI system

### Backend

Recommended:

- hosted Postgres
- Prisma ORM
- server functions or lightweight API layer

### Auth

Recommended first:

- email/password or magic link
- admin/operator roles
- later add Google and Facebook

### File storage

Recommended:

- cloud object storage for horse media and documents
- signed upload flow
- stored metadata in database

## Core Domain Models For Phase 1

At minimum, Phase 1 needs:

### User

- id
- email
- name
- role
- organizationId
- status
- createdAt

### Organization

- id
- legalName
- displayName
- planTier
- createdAt

### Horse

- id
- organizationId
- registeredName
- barnName
- segment
- status
- sex
- breed
- aqhaNumber
- registrationNumber
- ownerDisplayName
- ownerEntity
- profileImageUrl
- createdAt
- updatedAt

### OwnershipRecord

- id
- horseId
- legalOwner
- transferStatus
- complianceDeadline
- confidence
- createdAt
- updatedAt

### OwnershipStake

- id
- horseId
- name
- share
- role
- contact

### Document

- id
- organizationId
- horseId nullable
- batchId nullable
- title
- type
- source
- state
- confidence
- duplicateRisk
- uploadedByUserId
- uploadedAt
- fileUrl
- extractedText
- createdAt
- updatedAt

### OCRBatch

- id
- organizationId
- label
- source
- fileCount
- processedCount
- needsReviewCount
- matchedCount
- state
- receivedAt

### MediaAsset

- id
- horseId
- label
- kind
- fileUrl
- status
- uploadedAt

### AuditEvent

- id
- organizationId
- actorUserId
- entityType
- entityId
- action
- summary
- metadata json
- createdAt

## Phase 1 UX Requirements

The product must make the new shared mode visible and trustworthy.

Add:

- sign-in state
- active workspace / organization identity
- upload progress and success/failure feedback
- clear record save feedback
- audit trail surfaces on important actions

Do not:

- pretend social login is live before it is
- pretend OCR is fully automated before provider wiring exists

## Rollout Strategy

## Step 1: Service abstraction

Refactor current write actions so the UI does not depend directly on the local store as the long-term source of truth.

Introduce:

- horse service
- ownership service
- document service
- media service
- auth/session service

## Step 2: Demo adapter and shared adapter

Provide:

- demo adapter using current local store behavior
- shared adapter contract for real backend mode

## Step 3: Schema expansion

Replace the old toy Prisma shape with real XBAR models.

The current Prisma schema is too shallow and only models a basic horse entity.

## Step 4: Auth and organization layer

Add:

- user model
- organization model
- session foundation
- role assignment

## Step 5: Storage and metadata

Separate:

- document file storage
- media file storage
- metadata records in DB

## Step 6: Audit events

Every important mutation should create a durable audit event:

- horse created
- ownership updated
- document uploaded
- document approved
- media uploaded

## Immediate Engineering Tasks

### Task 1

Create service interfaces so the UI can stop depending on direct local-only writes.

### Task 2

Expand Prisma schema to support:

- organizations
- users
- horses
- ownership
- documents
- OCR batches
- media
- audit events

### Task 3

Refactor current actions to use service entry points.

### Task 4

Introduce app runtime config:

- demo mode
- shared mode

### Task 5

Create initial auth/session model and shared-mode placeholders.

## Acceptance Criteria

Phase 1 is successful when:

- the demo still works
- the codebase has a real shared-mode foundation
- the data model matches the product wedge
- ownership records are first-class
- documents and media are modeled for durable storage
- auth and organization models exist
- audit events have a defined home

## What This Enables Next

Once Phase 1 is in place, the next work becomes much more valuable:

- real OCR provider integration
- real owner portal accounts
- real billing and entitlements
- real team collaboration
- real buyer-facing packet links

## Recommended Immediate Priority

The next engineering order should be:

1. service abstraction
2. real Prisma schema
3. shared-mode data contracts
4. auth/session foundation
5. file storage model
6. audit events
