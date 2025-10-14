# Sandbox base image with development tools, Python, Node.js, and Bun
FROM oven/bun:latest AS bun-source
FROM ubuntu:22.04

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install essential system packages and development tools
RUN apt-get update && apt-get install -y \
    # Basic utilities
    curl \
    wget \
    git \
    unzip \
    zip \
    # Process management
    procps \
    htop \
    # Build tools
    build-essential \
    pkg-config \
    # Network tools
    net-tools \
    iputils-ping \
    dnsutils \
    # Text processing
    jq \
    vim \
    nano \
    # Python dependencies
    python3.11 \
    python3.11-dev \
    python3-pip \
    python3.11-venv \
    # Other useful tools
    ca-certificates \
    gnupg \
    lsb-release \
    strace \
    && rm -rf /var/lib/apt/lists/*

# Set Python 3.11 as default python3
RUN update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1

# Install Node.js 20 LTS using official NodeSource setup script
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install Bun from official image (avoids architecture compatibility issues)
COPY --from=bun-source /usr/local/bin/bun /usr/local/bin/bun
COPY --from=bun-source /usr/local/bin/bunx /usr/local/bin/bunx

# Install essential Python packages for code execution
RUN pip3 install --no-cache-dir \
    matplotlib \
    numpy \
    pandas \
    ipython

# Verify installations
RUN python3 --version && \
    node --version && \
    npm --version && \
    bun --version

# Set up build workspace for monorepo packages
WORKDIR /build

# Copy workspace packages and tooling
COPY tooling/typescript-config ./tooling/typescript-config
COPY packages/shared ./packages/shared
COPY packages/sandbox-container ./packages/sandbox-container

# Create minimal workspace package.json
RUN echo '{"private":true,"workspaces":["tooling/typescript-config","packages/shared","packages/sandbox-container"]}' > package.json

# Install all workspace dependencies
RUN npm install

# Build shared package first (dependency)
RUN cd packages/shared && npm run build

# Build sandbox-container
RUN cd packages/sandbox-container && npm run build

# Set up runtime container server directory
WORKDIR /container-server

# Copy built sandbox-container to runtime location
RUN cp -r /build/packages/sandbox-container/dist ./dist && \
    cp /build/packages/sandbox-container/package.json ./

# Copy Python executor to dist/runtime/executors (JS/TS executors are already compiled there)
RUN mkdir -p /container-server/dist/runtime/executors/python && \
    cp /build/packages/sandbox-container/src/runtime/executors/python/ipython_executor.py /container-server/dist/runtime/executors/python/

# Copy node_modules for runtime (includes workspace-linked shared package)
RUN cp -r /build/node_modules ./node_modules

# Configure process pool sizes (can be overridden at runtime)
ENV PYTHON_POOL_MIN_SIZE=3
ENV PYTHON_POOL_MAX_SIZE=15
ENV JAVASCRIPT_POOL_MIN_SIZE=3
ENV JAVASCRIPT_POOL_MAX_SIZE=10
ENV TYPESCRIPT_POOL_MIN_SIZE=3
ENV TYPESCRIPT_POOL_MAX_SIZE=10

# Create clean workspace directory for user code
# Architecture:
#   /container-server/ - SDK infrastructure (server, executors, dependencies)
#   /workspace/ - User's clean workspace for their code
RUN mkdir -p /workspace

# Expose the application port (3000 for control)
EXPOSE 3000

# Copy and make startup script executable
COPY packages/sandbox/startup.sh ./
RUN chmod +x startup.sh

# Use startup script
CMD ["./startup.sh"]
