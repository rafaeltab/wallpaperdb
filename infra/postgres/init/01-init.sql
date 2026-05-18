-- WallpaperDB PostgreSQL Initialization Script
-- Creates separate databases for each service

-- Create database for the ingestor service
CREATE DATABASE wallpaperdb_ingestor;

-- Create database for the media service
CREATE DATABASE wallpaperdb_media;

-- Create database for the tags service
CREATE DATABASE wallpaperdb_tags;

-- Grant all privileges to the wallpaperdb user on service databases
GRANT ALL PRIVILEGES ON DATABASE wallpaperdb_ingestor TO wallpaperdb;
GRANT ALL PRIVILEGES ON DATABASE wallpaperdb_media TO wallpaperdb;
GRANT ALL PRIVILEGES ON DATABASE wallpaperdb_tags TO wallpaperdb;
