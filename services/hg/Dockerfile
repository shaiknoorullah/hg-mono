# syntax=docker/dockerfile:1.7

# Build stage. Pinned to a specific Go minor so a toolchain bump is a reviewed
# diff rather than something that happens on a Tuesday.
# go.mod requires go >= 1.25.0, so the base image must be 1.25 (a 1.24 image with
# GOTOOLCHAIN=local refuses to build the module).
FROM golang:1.25-bookworm AS build

WORKDIR /src

# Dependencies first, in their own layer: source edits do not re-download the
# module graph.
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

COPY . .

ARG VERSION=dev
ARG TARGETOS=linux
ARG TARGETARCH=amd64

# CGO_ENABLED=0 is what makes the distroless static base viable: a pure-Go
# binary with no dynamic loader and no libc to keep patched.
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build \
      -trimpath \
      -ldflags="-s -w" \
      -o /out/hg \
      ./cmd/hg

# The migrate image's entrypoint (cmd/migrate): it reads goose's connection
# string from GOOSE_DBSTRING_FILE when that is set, then starts goose.
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -trimpath -ldflags="-s -w" -o /out/hg-migrate ./cmd/migrate

# Fail the build rather than the deploy if the binary is not actually static.
RUN ! ldd /out/hg 2>/dev/null | grep -q "=>" || (echo "hg is not statically linked" && exit 1)

# Migration runner. The schema in ./migrations is goose-annotated
# (-- +goose Up / -- +goose Down), so the runner is goose. Building it here
# rather than pulling a third-party image keeps the toolchain, the Go version
# and the base image identical to the server's.
FROM golang:1.25-bookworm AS goose-build
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOBIN=/out go install github.com/pressly/goose/v3/cmd/goose@v3.24.1

# goose reads its connection string, password included, only from
# GOOSE_DBSTRING, and this image has no shell to turn a secret file into a
# variable. hg-migrate does that: given GOOSE_DBSTRING_FILE it reads the file
# and starts goose with the value, so the container's configuration holds only
# a path (issue #309: https://github.com/shaiknoorullah/hg-mono/issues/309).
# Without it, goose runs exactly as before. Arguments pass through: `migrate
# status` still runs `goose status`.
FROM gcr.io/distroless/static-debian12:nonroot AS migrate
COPY --from=goose-build /out/goose /usr/local/bin/goose
COPY --from=build /out/hg-migrate /usr/local/bin/hg-migrate
USER nonroot:nonroot
ENTRYPOINT ["/usr/local/bin/hg-migrate"]
CMD ["up"]

# Runtime stage. distroless/static holds no shell, no package manager and no
# busybox: there is nothing to exec into if the process is ever compromised.
FROM gcr.io/distroless/static-debian12:nonroot AS runtime

# CA certificates and /etc/passwd come from the base image; nonroot is uid 65532.
COPY --from=build /out/hg /usr/local/bin/hg

USER nonroot:nonroot
EXPOSE 8080

# No shell form: there is no shell. This is exec form and PID 1 is the server,
# so SIGTERM reaches it directly and the graceful shutdown path actually runs.
ENTRYPOINT ["/usr/local/bin/hg"]
