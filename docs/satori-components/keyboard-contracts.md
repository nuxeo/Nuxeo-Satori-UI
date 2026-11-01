# Component keyboard contracts

NXSAT-665 adds behavior assertions to the built-in `nxs-` component stories. Run them in
Chromium with `npm run storybook:interactions` after
`npx nx run satori-components:build-storybook`. A story must assert the result of a key press:
an emitted value, a changed selection, an opened or dismissed panel, or the resulting focus.
Rendering a control alone does not establish its keyboard contract.

These are component API invariants, not a second WCAG verdict. Storybook's axe observations
remain informational. The ownership rules in [Accessibility](../accessibility.md) still apply.
The Satori adapter has a separate Storybook; this inventory describes the built-in components
shipped by `provideNxsComponents()`.

## 1. Interactive components

Stories live under `libs/shared/satori-components/src/lib/<component>/`. Existing stories are
included here so that a component's coverage is not mistaken for a new test merely because it
belongs to this ticket.

| Component                      | Story                                                                     | Asserted behavior                                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Action menu                    | `KeyboardContract`                                                        | Enter opens; arrows wrap past a disabled item; selection emits the entry; Escape closes and restores focus                             |
| Banner                         | `TrashedDocument`                                                         | Enter/Space invoke the corresponding action; Tab reaches the next action                                                               |
| Breadcrumbs                    | `FollowingALink`                                                          | Enter follows the router link and produces the expected URL                                                                            |
| Card                           | `KeyboardContract`                                                        | Space selects without opening; Enter/Space on the title open the card                                                                  |
| Chip set                       | `KeyboardContract`                                                        | Enter/Space emit the chip whose remove button was focused; Tab reaches the next button                                                 |
| Column picker                  | `KeyboardContract`                                                        | Initial dialog focus; required checkbox disabled; Space changes pending selection; Escape discards it; Enter applies the selected keys |
| Comments                       | `Thread`                                                                  | Enter expands a collapsed reply count and reveals the replies                                                                          |
| Date input                     | `KeyboardContract`, `TypedInAmericanEnglish`, `TypedInFrench`, `NotADate` | Enter opens the calendar; Escape restores focus without changing the date; typed dates and invalid text resolve as specified           |
| Details panel                  | `SwitchedFromTheKeyboard`                                                 | Arrows wrap and activate; Home/End jump; the panel is labelled by the active tab; Enter requests close                                 |
| Document history               | `History`                                                                 | Typing in the username field filters the rendered audit entries                                                                        |
| Document list                  | `KeyboardSelection`                                                       | Space selects; Shift+Down extends selection; Enter opens the focused document                                                          |
| Document reference input       | `MultipleFromTheKeyboard`                                                 | Keyboard choice, chip navigation/removal, focus recovery and required validation                                                       |
| Document toolbar               | `KeyboardContract`                                                        | Disabled action stays inert; Tab reaches the next action; Space emits the action and invokes the handler                               |
| Document tree                  | `FromTheKeyboard`, `KeyboardExpansion`                                    | Down/Enter navigate; Left/Right collapse, expand and move between parent/child; Home/End move to the ends                              |
| Dropzone                       | `KeyboardContract`                                                        | Enter/Space invoke the native chooser; its file result is emitted                                                                      |
| Error state                    | `ServerErrorWithRetry`                                                    | Enter/Space request retry                                                                                                              |
| Favorite toggle                | `KeyboardContract`                                                        | Enter/Space toggle the confirmed state, emit it and update `aria-pressed` while retaining focus                                        |
| Manage versions                | `KeyboardContract`                                                        | Enter opens the version list and selects a version through its radio menu item                                                         |
| Metadata editor                | `AsTabs`                                                                  | Keyboard selection of a schema tab reveals that schema's fields                                                                        |
| Pager                          | `KeyboardContract`                                                        | Enter/Space emit the previous/next page index; Tab and Shift+Tab move between controls                                                 |
| Permissions panel              | `ReadFailed`                                                              | Keyboard retry replaces a load failure with the permissions tables                                                                     |
| Properties panel               | `FileProperties`                                                          | Enter on the publication count requests the publications view                                                                          |
| Rich tooltip                   | `OpensOnFocus`, `KeyboardDismissal`                                       | Tab opens; Escape closes without moving focus; Enter reopens; leaving the trigger closes                                               |
| Saved search actions           | `KeyboardContract`                                                        | Enter requests Save As                                                                                                                 |
| Saved search select            | `KeyboardContract`                                                        | ArrowDown identifies the active option; Enter emits the selected search and closes the list                                            |
| Search filters                 | `KeyboardContract`                                                        | Enter resets filters; Reset and Save As then become disabled                                                                           |
| Tag editor                     | `Editable`                                                                | ArrowDown/Enter choose a new tag and show the normalized saved tag                                                                     |
| Tag input                      | `KeyboardContract`                                                        | ArrowDown/Enter add a tag and return to an empty focused input                                                                         |
| Tabs                           | `SelectedFromTheKeyboard`                                                 | Arrows move focus, Enter activates and emits the exact tab, Home/End jump, and `aria-controls` identifies its panel                    |
| Toast                          | `WithAnAction`                                                            | Keyboard activation invokes Undo and dismisses the toast                                                                               |
| Upload queue                   | `Refused`                                                                 | Enter requests retry for a failed upload                                                                                               |
| User/group picker              | `MultipleFromTheKeyboard`                                                 | Keyboard choice, chip navigation/removal, focus recovery and required validation                                                       |
| Vocabulary select              | `KeyboardContract`                                                        | ArrowDown identifies the active option; Enter commits its ID, closes the list and retains input focus                                  |
| Administration user/group list | `Populated`                                                               | Enter emits the chosen user's ID                                                                                                       |
| Administration user details    | `Profile`                                                                 | Enter emits the chosen group's ID                                                                                                      |
| Administration group details   | `Profile`                                                                 | Enter emits the chosen member's ID                                                                                                     |

The confirm dialog's `Asking` story asserts that keyboard confirmation closes with `true`.
`KeyboardCancellation` in change-password, create-version, delete-permission, drive,
folder-picker, group-form, rename, share-external, update-permission and user-form asserts the
close request made by the Cancel/Close button. These previews deliberately stay mounted:
`dialogPreview` provides layout and a fake `MatDialogRef`, not an actual modal overlay.
Their cancellation assertions do **not** claim to measure modal focus containment, Escape
handling by `MatDialog`, or restoration after destruction.

## 2. Components without their own keyboard action

Avatar, document-type icon, domain hint, icon, spinner, status tag, tag and thumbnail are
presentation components. Empty state and folder header project actions supplied by the host;
their own API has no keyboard action. The registered-primitives story is a composition of
the same components, not another implementation. Do not invent key handlers or focus stops
for these components to satisfy a coverage count. Their rendered semantics remain observable
by the Storybook a11y panel and owned by the runtime accessibility layer.

## 3. Live interaction states

`npm run a11y:scan -- states` exercises real browse components against Nuxeo. State entry uses
Enter. The column picker is located through `nxs-column-picker` and its dialog role, and the
calendar trigger is the first of the two `nxs-date-input` fields. The picker asserts modal
state, initial focus, Escape dismissal and focus restoration to its opener. a11y-scout owns
the keyboard walk and focus-visibility observations in these live states.

A successful command is not a zero-findings claim: the existing scanner records untriaged
findings with `failOnBlockers: false`. Check the per-state report and AI provider failures
before describing what was measured. A failed HAIP call means AI content quality was not
measured, even when deterministic keyboard checks complete.

## 4. Authoring and verification

- Material key managers read legacy `keyCode`. Their play functions use `fireEvent.keyDown`
  with the browser key code; native button activation uses `userEvent.keyboard`.
- Wait for the observable result before asserting the next step. A datepicker ignores
  dismissal during its entry animation, so its story waits for the browser's animations to
  finish before pressing Escape.
- Native file-picker UI is outside the page. The dropzone story spies on invocation of the
  input's `click`, then supplies the selected file; it does not automate an operating-system
  dialog.
- Keep existing screenshot stories open where their visual capture depends on that state;
  use a separate interaction story for selecting or dismissing the overlay.
- Negative-control new checks by temporarily changing the expected emitted value or breaking
  the relevant binding, observing a failing interaction run, and restoring the source.
