# Paper Library — uuu4/blog

Static, single-file blog for paper reviews. Public read, owner-only writes (via repo commit).

## How it works

- `index.html` is the app. On load it fetches `data.json` from the same origin.
- **Visitors** see whatever is in the deployed `data.json`. Their edits never persist (they don't have repo access; localStorage isn't even used for non-admins).
- **You (admin)** log in with the password (default `admin123`), edit in-browser, click **Export** to download the new `data.json`, then commit it to this repo. GitHub Pages redeploys → visitors see the update in ~30–90 sec.
- **Pull** discards your local draft and re-fetches the deployed `data.json`.

## Files

| File | Purpose |
|---|---|
| `index.html` | The app |
| `data.json` | Published content (papers + CV) |
| `CNAME` | Custom domain (one line: your domain) |
| `.nojekyll` | Tells GitHub Pages not to run Jekyll |
| `README.md` | This file |

---

## Deploy: GitHub Pages

### 1. Push the folder to `uuu4/blog`

From this `BLOG/` directory:

```bash
cd /Users/aliemreaydin/Desktop/BLOG
git init -b main
git add .
git commit -m "Initial deploy"
git remote add origin https://github.com/uuu4/blog.git
git push -u origin main
```

(Repo `uuu4/blog` must exist and be **public** on GitHub first — create it via github.com/new.)

### 2. Enable Pages

Repo → **Settings → Pages**:
- **Source**: Deploy from a branch
- **Branch**: `main` / `/ (root)` → **Save**

In ~1 minute the site is live at `https://uuu4.github.io/blog/`.

### 3. Edit workflow

1. Open the live site, click 🔒 **GUEST** → log in (default password `admin123`)
2. Edit papers, ratings, notes, CV
3. Click **⬇ Export** (in the Reviews window toolbar) — `data.json` downloads
4. Replace `data.json` in this repo with the downloaded file, commit, push
5. Wait ~30-90 sec for Pages to redeploy
6. Click **↻ Pull** in the app to clear your local draft and verify the published state

> **Change the admin password.** In devtools console:
> `localStorage.setItem('pl-admin-pass','your-new-pass')`
> Note: this is a cosmetic gate, not real auth — anyone with devtools can override it. The only thing that actually controls publishing is git push access to the repo.

---

## Custom domain (Hostinger)

You'll do two things: tell GitHub the domain, and tell Hostinger DNS where to point.

### A. Decide: apex or subdomain?

- **Apex** (e.g. `yourdomain.com`) → uses A records. Slightly more setup.
- **Subdomain** (e.g. `blog.yourdomain.com`) → uses one CNAME. Simpler. **Recommended.**

### B. Edit `CNAME` file

Put your domain in `CNAME` (one line, no `https://`, no trailing slash):

```
blog.yourdomain.com
```

Commit & push. GitHub Pages will read this file on next deploy.

### C. Hostinger DNS

Log in to Hostinger → **Domains** → pick the domain → **DNS / Nameservers** → **DNS Zone Editor**.

**For a subdomain (`blog.yourdomain.com`):**

| Type  | Name | Points to        | TTL  |
|-------|------|------------------|------|
| CNAME | blog | uuu4.github.io.  | 3600 |

(If Hostinger UI doesn't accept the trailing dot, drop it.)

**For apex (`yourdomain.com`):** add four A records, all with name `@`:

| Type | Name | Points to       | TTL  |
|------|------|-----------------|------|
| A    | @    | 185.199.108.153 | 3600 |
| A    | @    | 185.199.109.153 | 3600 |
| A    | @    | 185.199.110.153 | 3600 |
| A    | @    | 185.199.111.153 | 3600 |

Optional IPv6 (AAAA, name `@`): `2606:50c0:8000::153`, `…8001::153`, `…8002::153`, `…8003::153`.

If Hostinger has a default A/AAAA record on `@` pointing to their parking page, **delete it** before adding the GitHub ones.

### D. Verify in GitHub

Repo → **Settings → Pages** → **Custom domain** field: type the same domain → **Save**.

Wait until the green "DNS check successful" appears (a few minutes to ~1 hour). Then check **Enforce HTTPS** — GitHub provisions a Let's Encrypt cert automatically.

### E. Done

Visit `https://blog.yourdomain.com`. If it 404s for a few minutes, that's DNS propagation; refresh.

Test: `dig blog.yourdomain.com +short` should return `uuu4.github.io.` followed by GitHub's IPs.

---

## Local preview

```bash
cd /Users/aliemreaydin/Desktop/BLOG
python3 -m http.server 8000
# open http://localhost:8000
```

(Opening `index.html` directly via `file://` won't work — `fetch('./data.json')` is blocked on the file protocol.)

## Notes

- Caching: `fetch` uses `cache: 'no-store'` + a `?t=` query, so your browser always gets fresh JSON. CDN edge cache on GitHub Pages can lag a few minutes after a push.
- The old `Paper Library.html` file is the same as `index.html`; you can delete it.
