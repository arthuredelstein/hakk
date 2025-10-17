#!/bin/bash

# Script to set up different pre-push hook strategies

echo "🔧 Setting up Git pre-push hooks..."
echo "=================================="

# Check if we're in a git repository
if [ ! -d ".git" ]; then
    echo "❌ Error: Not in a git repository"
    exit 1
fi

# Check if husky is installed
if [ ! -d ".husky" ]; then
    echo "📦 Installing husky..."
    npx husky init
fi

echo "Choose your pre-push strategy:"
echo "1. Full tests (runs all tests on every push)"
echo "2. Smart tests (runs linting on changed files, all tests)"
echo "3. Disable pre-push hook"
echo "4. Custom hook"
echo ""

read -p "Enter your choice (1-4): " choice

case $choice in
    1)
        echo "Setting up full test pre-push hook..."
        cp .husky/pre-push .husky/pre-push.backup 2>/dev/null || true
        echo 'echo "🧪 Running pre-push tests..."
echo "================================"

# Run linting and tests
npm run test:ci

if [ $? -eq 0 ]; then
    echo "✅ All tests passed! Proceeding with push..."
    echo "================================"
    exit 0
else
    echo "❌ Tests failed! Push aborted."
    echo "💡 Fix the failing tests and try again."
    echo "================================"
    exit 1
fi' > .husky/pre-push
        chmod +x .husky/pre-push
        echo "✅ Full test hook installed!"
        ;;
    2)
        echo "Setting up smart test pre-push hook..."
        cp .husky/pre-push .husky/pre-push.backup 2>/dev/null || true
        cp .husky/pre-push-smart .husky/pre-push
        chmod +x .husky/pre-push
        echo "✅ Smart test hook installed!"
        ;;
    3)
        echo "Disabling pre-push hook..."
        mv .husky/pre-push .husky/pre-push.disabled 2>/dev/null || true
        echo "✅ Pre-push hook disabled!"
        ;;
    4)
        echo "Opening editor for custom hook..."
        echo "Edit .husky/pre-push to customize your pre-push behavior"
        echo "Make sure to make it executable: chmod +x .husky/pre-push"
        ;;
    *)
        echo "❌ Invalid choice"
        exit 1
        ;;
esac

echo ""
echo "🎉 Setup complete!"
echo ""
echo "To test your hook:"
echo "  git add ."
echo "  git commit -m 'test'"
echo "  git push  # This will now run tests first"
echo ""
echo "To bypass the hook (emergency only):"
echo "  git push --no-verify"
