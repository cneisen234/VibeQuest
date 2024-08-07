-- Enum types
-- CREATE TYPE privacy_setting AS ENUM ('public', 'friends_only', 'private');
-- CREATE TYPE friendship_status AS ENUM ('accepted', 'pending', 'blocked');
-- CREATE TYPE friend_request_status AS ENUM ('pending', 'accepted', 'rejected');

-- Users table
CREATE TABLE users
(
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    avatar TEXT,
    bio TEXT,
    bio_visibility privacy_setting DEFAULT 'public',
    interests_visibility privacy_setting DEFAULT 'public'
);

-- Interests table
CREATE TABLE interests
(
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    category VARCHAR(100) NOT NULL,
    visibility privacy_setting DEFAULT 'public'
);

-- Items table (for interests)
CREATE TABLE items
(
    id SERIAL PRIMARY KEY,
    interest_id INTEGER REFERENCES interests(id),
    name VARCHAR(100) NOT NULL,
    rating INTEGER CHECK (rating >= 1 AND rating <= 10)
);

-- Friends table
CREATE TABLE friends
(
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    friend_id INTEGER REFERENCES users(id),
    status friendship_status DEFAULT 'pending',
    UNIQUE(user_id, friend_id)
);

-- Friend Requests table
CREATE TABLE friend_requests
(
    id SERIAL PRIMARY KEY,
    sender_id INTEGER REFERENCES users(id),
    receiver_id INTEGER REFERENCES users(id),
    status friend_request_status DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(sender_id, receiver_id)
);