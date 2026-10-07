<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

- Buddy appearance is configured in a shared visual registry consumed by BuddyAvatar; role changes must not alter Buddy business records.
- Premium avatar mode uses transparent pre-rendered 3D artwork with a matching inline vector fallback, not the mechanical starter GLBs; this avoids WebGL overhead and guarantees a fallback without network access.
- BuddyLogo is the shared brand mark; avatar motion lives in global CSS and honors reduced-motion preferences.
