-- WallpaperDB PostgreSQL Initialization Script
-- Simple example table for testing

CREATE TABLE IF NOT EXISTS example_items (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Insert a test record
INSERT INTO example_items (name) VALUES ('example_item_1');
