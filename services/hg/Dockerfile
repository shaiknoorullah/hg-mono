# syntax=docker/dockerfile:1.7

# Build stage. Pinned to a specific Go minor so a toolchain bump is a reviewed
# diff rather than something that happens on a Tuesday.
FROM golang:1.24-bookworm AS build

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

# Fail the build rather than the deploy if the binary is not actually static.
RUN ! ldd /out/hg 2>/dev/null | grep -q "=>" || (echo "hg is not statically linked" && exit 1)

# Migration runner. The schema in ./migrations is goose-annotated
# (-- +goose Up / -- +goose Down), so the runner is goose. Building it here
# rather than pulling a third-party image keeps the toolchain, the Go version
# and the base image identical to the server's.
FROM golang:1.24-bookworm AS goose-build
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOBIN=/out go install github.com/pressly/goose/v3/cmd/goose@v3.24.1

FROM gcr.io/distroless/static-debian12:nonroot AS migrate
COPY --from=goose-build /out/goose /usr/local/bin/goose
USER nonroot:nonroot
ENTRYPOINT ["/usr/local/bin/goose"]
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
