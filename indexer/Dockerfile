# Builds the Carbon indexer as a standalone binary for Render's Docker
# runtime (Render has no native Rust buildpack). Build context is this
# directory (see render.yaml's dockerContext: indexer) — paths below are
# relative to indexer/, not the repo root.
#
# sqlx::migrate!() embeds migrations/*.sql into the binary at compile time,
# so the runtime image needs nothing beyond the compiled executable.
FROM rust:1.83-slim-bookworm AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libssl-dev ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY decoder ./decoder
COPY src ./src
COPY migrations ./migrations

RUN cargo build --release --bin indexer

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --create-home indexer

COPY --from=builder /build/target/release/indexer /usr/local/bin/indexer

USER indexer
ENV RUST_LOG=info
ENTRYPOINT ["/usr/local/bin/indexer"]
