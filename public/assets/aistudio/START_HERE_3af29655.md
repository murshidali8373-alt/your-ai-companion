# AI Buddy — working MVP (start here)

**AI Buddy** is a browser assistant you *talk to* in Hindi, Hinglish or English. It does one thing at a time on the
real page (open a site, search, point, click, fill fields, pick from dropdowns, scroll, submit), **checks that it worked**,
tells you honestly what happened, and waits for your next instruction. When it is not sure, it asks instead of guessing.

## 5-minute demo (no internet, no AI key needed)

1. **Install the extension** — unzip first. Chrome → `chrome://extensions` → *Developer mode* → *Load unpacked* → pick the folder **`ai-buddy-mvp\extension`** (the one that directly contains `manifest.json`, not a parent folder). Pin AI Buddy (puzzle icon) and open its side panel.
   *Updated the files later? Click the circular reload arrow on the AI Buddy card in `chrome://extensions`.*
2. **Start the demo portal** (a fictional citizen-services site that ships with this project):
   Windows: `py -m http.server 8080 --directory public` · Mac/Linux: `python3 -m http.server 8080 --directory public`
   → open **http://localhost:8080/demo/** (run it inside the `ai-buddy-mvp` folder)
3. Say or type these, **one at a time** (mic button works for voice). Watch the *page*, not just the chat:

| Say | What really happens |
|---|---|
| "Is page par kya kya hai" | Buddy reads the page and lists its fields, buttons and the separate scrolling notices area |
| "Search box mein pension likho" | Text appears in the search box. It does **not** search yet |
| "Ab search button click karo" | Search runs, the list filters, Buddy reports the change |
| "Naam Murshad Ali, mobile 9876543210, email murshad@example.com bhar do" | Three fields filled in one go, each one read back and verified |
| "Aadhaar number field mein 123456789012 daal do" | Filled only because *you* said it; the number is masked in the chat log |
| "State mein Delhi select karo" | Dropdown really changes. "State mein Atlantis select karo" is refused honestly |
| "Submit karo" | Buddy **asks for your yes** first (Approve / Cancel card) |
| *(press Approve)* | The site answers "Please fix: terms acceptance" — **Buddy repeats what the site said** instead of claiming success |
| "Terms checkbox tick karo" → "Submit karo" → Approve | Application goes through; Buddy reports the real reference number |
| "Login par click karo" | Two Login controls exist: Buddy lists both and asks. Say "doosra" |
| "Apply Now par click karo" | Three identical buttons: it asks which service ("teesra") |
| "Notices ko neeche scroll karo" | Only the notices box scrolls, not the page |
| "ab tak kya kiya" | Activity log with ✓ confirmed / ? unconfirmed / ✗ failed |

Typing shortcuts work too ("type kr do", "is page pr", "yha msg main … type kr do"). "122 search karo is page par" searches inside the page and never leaves it.

Say "Aadhaar ki official website search karo" on a normal internet connection to see it search, pick the genuine
government site over ads/news, open it and report the real URL (asks if two different organisations look official).

## What is verified (and what is not)

Run `npm run test:real` (needs `npm i -D playwright && npx playwright install chromium`).

| Check | Result |
|---|---|
| Full demo journey with the **real unpacked extension in real Chromium**, 16 steps, asserting on the page itself | 16 / 16 pass |
| Same journey on the **original, pre-update extension** (control) | 1 / 16 pass |
| Real `background.js` against real DOM fixtures (ambiguity, stale targets, verification, failures, scrolling) | 29 / 29 |
| Search → pick official site → open → verify URL (local fixtures) | 5 / 5 |
| End-to-end through the real side-panel page | 16 / 16 |
| Language understanding unit tests (Hindi/Hinglish/English, Devanagari, texting shortcuts like "kr"/"pr") | 22 |

**Not verified — be upfront about these when showing it:**
- Live Google / live government sites (this was built offline; Google's page layout changes — Buddy then falls back to DuckDuckGo, then says it failed).
- The docked Chrome side-panel UI and microphone input (tested as a normal page, voice not tested).
- Real users. Everything above is automated; `docs/REAL_CHROME_TEST_CHECKLIST.md` is the manual script for your own Chrome.
- Free-form requests the built-in language layer does not recognise go to the existing AI backend, which needs its server / key.

## Design rules that make it trustworthy

One action at a time · never guess between similar elements · re-check the target before every action · fill is not submit ·
submit always needs an explicit yes · report what the page actually did · mask Aadhaar/PAN/card/passwords in the chat ·
explain failures plainly. Details: `docs/BUDDY_STEP_CONTROLLER.md`.
