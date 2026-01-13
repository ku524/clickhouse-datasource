#!/bin/bash
set -e

# Configuration
ECR_REGISTRY="314716043882.dkr.ecr.ap-northeast-2.amazonaws.com"
IMAGE_NAME="infra/grafana"
VERSION="12.3.1-customv3"
AWS_PROFILE="ops"
AWS_REGION="ap-northeast-2"

# Architecture-specific tags
AMD64_TAG="${ECR_REGISTRY}/${IMAGE_NAME}:${VERSION}-amd64"
ARM64_TAG="${ECR_REGISTRY}/${IMAGE_NAME}:${VERSION}-arm64"
MANIFEST_TAG="${ECR_REGISTRY}/${IMAGE_NAME}:${VERSION}"

echo "🔐 Logging in to ECR..."
aws ecr get-login-password --region ${AWS_REGION} --profile ${AWS_PROFILE} | \
  docker login --username AWS --password-stdin ${ECR_REGISTRY}

# Build both images in parallel
echo "🏗️  Building AMD64 and ARM64 images in parallel..."

docker build \
  --platform linux/amd64 \
  -f Dockerfile.custom \
  -t ${AMD64_TAG} \
  . &
AMD64_PID=$!

docker build \
  --platform linux/arm64 \
  -f Dockerfile.custom \
  -t ${ARM64_TAG} \
  . &
ARM64_PID=$!

echo "⏳ Waiting for builds to complete..."
wait ${AMD64_PID}
AMD64_EXIT=$?
wait ${ARM64_PID}
ARM64_EXIT=$?

if [ ${AMD64_EXIT} -ne 0 ] || [ ${ARM64_EXIT} -ne 0 ]; then
  echo "❌ Build failed!"
  exit 1
fi
echo "✅ Both builds completed successfully"

# Push both images
echo "📤 Pushing AMD64 image..."
docker push ${AMD64_TAG}

echo "📤 Pushing ARM64 image..."
docker push ${ARM64_TAG}

# Create and push manifest
echo "🔗 Creating multi-arch manifest..."
docker manifest create ${MANIFEST_TAG} \
  --amend ${AMD64_TAG} \
  --amend ${ARM64_TAG}

echo "📤 Pushing manifest..."
docker manifest push ${MANIFEST_TAG}

echo "✅ Done!"
echo "Images:"
echo "  - AMD64: ${AMD64_TAG}"
echo "  - ARM64: ${ARM64_TAG}"
echo "  - Manifest: ${MANIFEST_TAG}"
