# WSL (Windows Subsystem for Linux) Setup Guide

If you're experiencing issues with the regular Docker setup on WSL, this guide provides WSL-specific configurations and workarounds.

## Common WSL Issues

The most common issue is the Docker build failing after the `chown` command due to WSL's filesystem permission handling. This project includes WSL-specific configurations to address these issues.

## Quick Setup for WSL

1. **Ensure Docker Desktop is running** on Windows with WSL2 integration enabled
2. **Run the WSL-specific setup script**:
   ```bash
   ./setup-wsl.sh
   ```
3. **Start the services** (optional, as setup-wsl.sh starts them automatically):
   ```bash
   ./start-wsl.sh
   ```

## Manual WSL Setup

If you prefer to set up manually:

1. **Use the WSL-compatible Docker Compose file**:
   ```bash
   docker-compose -f docker-compose.wsl.yml up --build -d
   ```

2. **Alternative: Use the WSL-specific Dockerfile**:
   ```bash
   docker build -f Dockerfile.wsl -t game-server-wsl .
   ```

## Key Differences in WSL Configuration

### Dockerfile.wsl
- Removes problematic user switching that can fail on WSL
- Runs as root user (acceptable for development)
- Simplified permission handling

### docker-compose.wsl.yml
- Uses the WSL-specific Dockerfile
- Includes WSL-optimized volume mount options
- Better compatibility with WSL filesystem

## Troubleshooting WSL Issues

### Permission Errors
If you get permission errors:
```bash
# Reset Docker completely
docker-compose -f docker-compose.wsl.yml down --volumes --remove-orphans
docker system prune -a
./setup-wsl.sh
```

### Docker Desktop Integration
Ensure Docker Desktop has WSL2 integration enabled:
1. Open Docker Desktop
2. Go to Settings → Resources → WSL Integration
3. Enable integration with your WSL distribution

### Port Conflicts
If ports are already in use:
```bash
# Check what's using the ports
netstat -tulpn | grep :3002
netstat -tulpn | grep :27018

# Stop conflicting services or modify ports in docker-compose.wsl.yml
```

### File Watching Issues
If file changes aren't detected:
```bash
# Increase file watchers limit
echo fs.inotify.max_user_watches=524288 | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

## Development Workflow on WSL

1. **Start services**:
   ```bash
   ./start-wsl.sh
   # OR manually:
   docker-compose -f docker-compose.wsl.yml up -d
   ```

2. **Make code changes** in your preferred editor

3. **Rebuild when needed**:
   ```bash
   docker-compose -f docker-compose.wsl.yml up --build -d
   ```

4. **View logs**:
   ```bash
   docker-compose -f docker-compose.wsl.yml logs -f game-server
   ```

5. **Stop services**:
   ```bash
   docker-compose -f docker-compose.wsl.yml down
   ```

## Performance Tips for WSL

1. **Keep source code in Linux filesystem** (not Windows filesystem)
2. **Use WSL2** (not WSL1) for better Docker performance
3. **Allocate sufficient memory** to Docker Desktop (at least 4GB)
4. **Enable file sharing** for your WSL distribution in Docker Desktop

## Switching Back to Regular Setup

If you want to switch back to the regular setup:
```bash
# Stop WSL services
docker-compose -f docker-compose.wsl.yml down

# Start regular services
docker-compose up -d
```
