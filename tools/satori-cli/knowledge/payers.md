# A worked example: a health payer's members, claims and cases

How a request like "build us a claims app" goes, from a package with only its branding. Each step
is a recipe of [recipes.md](recipes.md). The examples' `payers-claims-demo` is a fuller app of the
same kind, built by Nuxeo; read it, and never copy its ids, types or groups.

1. **Read the server.** `describe_document_type` for the types the person names. On a development
   server with none of them, offer a stand-in model, for a demo or a prototype, and go on only on
   their yes.
2. **The app.** Ask its name and its groups, then add the app definition: for example the id
   `acme-claims`, the label "Acme Claims", the group `claims-adjusters`.
3. **The model**, on their yes, one `app-model` call a type:
   - `Member`: `memberId`, `fullName`, `plan=Gold|Silver|Bronze`, `dateOfBirth:date`,
     `status=Active|Inactive`, with a page provider `acme_members`;
   - `Claim`: `claimNumber`, `member:document`, `amount:double`, `serviceDate:date`,
     `status=Submitted|In review|Approved|Denied`, `priority=Normal|High`, with page providers
     `acme_claims_to_review` (`where` its status is Submitted or In review, `aggregates` its status
     and priority, `sort` its service date) and `acme_high_value_claims` (`where` its amount is
     over 10000);
   - `Case`: `caseNumber`, `claim:document`, `reason`, `status=Open|Closed`, with a page provider
     `acme_open_cases`.
4. **The record pages**: `app-layout` for each type. The `document` properties show as links to
   the record they name.
5. **The forms**: `app-form` `edit` and `create` for `Claim`, with `claim:claimNumber`,
   `claim:member` and `claim:amount` required.
6. **The queues**: `app-queue` for each page provider: "Claims to review", with the claim number,
   the member, the amount, the status and the priority; "High-value claims"; "Open cases".
7. **The home and the menu**: `home.json`, a figure for each queue and the claims changed last;
   `navigation.json`, the home and the three queues; their texts in `labels/en.json`;
   `app-registry`.
8. **Branding**: the title and the customer's colours ([branding.md](branding.md)).
9. **Check and build**: `npm run validate`, `npm run build`; then the person's steps.

What a request like this cannot be given by configuration, and is said so:

- **Workflows**, such as a claim's review: they are Nuxeo Studio's, and a task form is written for
  a workflow the server has.
- **Letters**, such as a denial letter: they need the letters add-on and Nuxeo's Template
  Rendering.
- **Buttons that run the customer's own Automation chains**: the chains are Studio's, and the
  deployment's allow-list a person's.
