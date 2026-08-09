# Hosting Floor Plan Studio (static)

The app is a single `index.html`. Any static host works.

## Option A — GitHub Pages (simplest for OSS)

1. Push this repo to GitHub.
2. Settings → Pages → Source: **Deploy from branch** → `main` / root.
3. Site URL will look like: `https://<user>.github.io/floor-plan-studio/`

## Option B — Amazon S3 + CloudFront (private bucket)

1. Create an S3 bucket (Block Public Access **ON**).
2. Upload `index.html` as the object key `index.html`.
3. Create a CloudFront distribution with the bucket as origin.
4. Enable **Origin Access Control (OAC)** so only CloudFront can read the bucket.
5. Set **Default root object** to `index.html`.
6. Viewer protocol: redirect HTTP → HTTPS.
7. Share the CloudFront URL (or attach a custom domain + ACM cert).

### Updating after changes

Re-upload `index.html`, then create a CloudFront invalidation for `/index.html` or `/*`.

### Sharing plans (not just the app)

- **View-only / editable links** from the UI embed the plan in the URL hash (no backend).
- For large plans: **Download JSON**, upload it (S3 object or any HTTPS URL with CORS if needed), then share:

```
https://YOUR-HOST/?planUrl=https://YOUR-BUCKET/.../plan.json&mode=view
```

## Cost notes

Static hosting at demo traffic is typically free or near-free (GitHub Pages, CloudFront free tier / low usage). You pay when you add auth, databases, or heavy bandwidth.
