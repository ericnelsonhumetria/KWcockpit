[build]
  publish = "public"
  functions = "netlify/functions"

[functions]
  node_bundler = "esbuild"

[[redirects]]
  from = "/api/qonto"
  to = "/.netlify/functions/qonto"
  status = 200

[[redirects]]
  from = "/api/evoliz"
  to = "/.netlify/functions/evoliz"
  status = 200

[[redirects]]
  from = "/api/hubspot"
  to = "/.netlify/functions/hubspot"
  status = 200
