# ali-automation-test

Automated test example of [aliexpress.com](https://www.aliexpress.com) website.

For testing purposes we assume that this is a REST API which returns the search results for a given term and product
details.

## What is the scope of this project?

- REST API
- Validation tests
- Container ready app

# Prerequisites

- Node.js 20.x (LTS)
- Docker

Browser automation uses [Playwright](https://playwright.dev), which manages its own Chromium build — there is no
longer any need to install Google Chrome or a matching `chromedriver` manually.

## Installing the dependencies

In the project directory, you can run:

```
npm install
npx playwright install --with-deps chromium
```

The first command installs the Node dependencies; the second downloads the Chromium build Playwright drives (skip it if
you run inside the Docker image below, which already ships with Chromium).

## Running the project

In the project directory, you can run:

`npm start`

It runs the app on http://localhost:8080. Example requests:

```
curl "http://localhost:8080/products?term=Iphone"
curl "http://localhost:8080/product/<id>"
```

### Configuration

The scraper reads these optional environment variables:

| Variable                   | Purpose                                                         |
|----------------------------|----------------------------------------------------------------|
| `PLAYWRIGHT_CHROMIUM_PATH` | Path to a pre-installed Chromium executable (skip the download) |
| `SCRAPER_PROXY_SERVER`     | Outbound HTTP proxy for the browser (falls back to `HTTPS_PROXY`) |
| `SCRAPER_USER_AGENT`       | Override the browser User-Agent                                |
| `SCRAPER_HEADLESS=false`   | Run the browser headed (debugging)                             |

## Running the tests

```
npm test        # fast, deterministic API tests with the scraper mocked (no network)
npm run test:e2e   # live end-to-end scraping against aliexpress.com (needs network egress)
```

`npm test` is what CI runs — it stubs the scraper so it never touches the network. `npm run test:e2e` drives the real
Playwright scraper against the live site and is expected to be run locally or on a scheduled job where outbound access
to `aliexpress.com` is allowed.

## Building for production

`npm run build`

It builds a Docker image based on the official Playwright image (Chromium + Node.js included). After building:

`docker run -d --rm -p 8080:8080 ali-automation-tool`

CI also builds and publishes this image to the GitHub Container Registry (GHCR) tagged with the git commit SHA:

`ghcr.io/devops-thiago/ali-automation-test:sha-<commit>`

## Generating Swagger API Doc

`npm run swagger-autogen`

After that, run the project and check http://localhost:8080/doc for Swagger API documentation.
