# Node 24 LTS ("Krypton"). Node 20 reached end of life, so it no longer
# receives security patches. Pinned by digest as well as tag so the same
# commit rebuilds the same image; change the tag and the digest together.
FROM node:24.20.0-alpine@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf

# Release identity, supplied by CI (--build-arg SLATE_RELEASE=$GITHUB_SHA).
# Reported at startup and on /api/health so a running container can be traced
# back to the commit it was built from.
ARG SLATE_RELEASE=unknown
ENV SLATE_RELEASE=$SLATE_RELEASE

WORKDIR /app

# Lockfile install, production dependencies only. Runs as root so npm can
# write into /app; the process itself drops to an unprivileged user below.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY public ./public
# The user guide. server/help.js requires it at load, and help.verify() runs at
# boot, so an image without this does not fail at the help screen — it fails to
# start at all. It is content rather than code, which is exactly why it was
# easy to leave out of the image.
COPY content ./content
COPY scripts/backup.js ./scripts/backup.js
COPY scripts/container-persistence.js ./scripts/container-persistence.js
# The operator preflight. It is the documented way to check model entitlement,
# and the check that matters is the one run in the environment the app runs in,
# so it ships with the image rather than living only on a developer's machine.
COPY scripts/preflight.js ./scripts/preflight.js

ENV NODE_ENV=production
ENV HOST=0.0.0.0

# DATA_DIR is deliberately NOT set here. server/db.js refuses to start in
# production without it, which is what stops the app from silently writing
# records into the container's ephemeral filesystem when no volume is
# attached. Set it in the deployment, alongside a real mounted volume.
#
# /data is created and owned by the runtime user for the common case where
# the deployment sets DATA_DIR=/data. A volume mounted over this path keeps
# its own ownership, so see "Container volume permissions" in README.md.
RUN mkdir -p /data && chown -R node:node /data /app

# The node image ships an unprivileged uid/gid 1000 "node" user. Everything
# after this point, including the app process, runs without root.
USER node

EXPOSE 4173
CMD ["node", "server/index.js"]
