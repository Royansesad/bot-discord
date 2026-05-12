# Use an official Node.js runtime as a parent image
FROM node:20-slim

# Install OpenSSL (required by Prisma)
RUN apt-get update -y && apt-get install -y openssl

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy the rest of the application code
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Create directory for SQLite database if it doesn't exist
RUN mkdir -p prisma

# Start the application. 
# We run `prisma db push` to ensure the SQLite schema is synced before starting the bot.
CMD ["sh", "-c", "npx prisma db push && npm start"]
