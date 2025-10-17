#!/bin/bash

# Test script to simulate GitHub Actions locally
# Run this to verify your tests pass before pushing

echo "🧪 Running local tests to simulate GitHub Actions..."
echo "=================================================="

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found. Please run this script from the project root."
    exit 1
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm ci

# Run linting
echo "🔍 Running linting with semistandard..."
if npx semistandard; then
    echo "✅ Linting passed!"
else
    echo "❌ Linting failed!"
    exit 1
fi

# Run tests
echo "🧪 Running tests..."
if npm test; then
    echo "✅ All tests passed!"
    echo "🚀 Ready to push to GitHub!"
else
    echo "❌ Tests failed!"
    echo "💡 Fix the failing tests before pushing to avoid rejection."
    exit 1
fi

echo "=================================================="
echo "✅ All checks passed! Your code is ready for GitHub."
