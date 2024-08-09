const express = require("express");
const cors = require("cors");
const pool = require("./db");
const bcrypt = require("bcrypt");
require("dotenv").config();
const jwt = require("jsonwebtoken");
const authMiddleware = require("./middleware/auth");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    // Fetch the user from the database, excluding the password
    const result = await pool.query(
      "SELECT id, email, name, password FROM users WHERE email = $1",
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const user = result.rows[0];

    // Compare the provided password with the stored hash
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    // Generate a JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );
    // Send the response with token and user info, excluding the password
    return res.json({
      message: "Login successful",
      token,
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch (error) {
    console.error("Error during login:", error);
    return res.status(500).json({ message: "Server error during login" });
  }
});

app.post("/api/auth/signup", async (req, res) => {
  const { name, username, email, password } = req.body;

  try {
    // Check if the email is already in use
    const emailCheck = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );
    if (emailCheck.rows.length > 0) {
      return res.status(400).json({ message: "Email already in use" });
    }

    // Check if the username is already taken
    const usernameCheck = await pool.query(
      "SELECT * FROM users WHERE username = $1",
      [username]
    );
    if (usernameCheck.rows.length > 0) {
      return res.status(400).json({ message: "Username already taken" });
    }

    // Hash the password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Insert the new user into the database
    const result = await pool.query(
      "INSERT INTO users (name, username, email, password) VALUES ($1, $2, $3, $4) RETURNING id",
      [name, username, email, hashedPassword]
    );

    res.status(201).json({
      message: "User created successfully",
      userId: result.rows[0].id,
    });
  } catch (error) {
    console.error("Error during signup:", error);
    res.status(500).json({ message: "Error creating user" });
  }
});

const PaymentTier = {
  Free: 1,
  Basic: 2,
  Premium: 3,
  Owner: 4,
};

const checkPaymentTier = async (userId, requiredTier) => {
  const result = await pool.query(
    "SELECT payment_tier FROM users WHERE id = $1",
    [userId]
  );
  if (result.rows.length === 0) {
    throw new Error("User not found");
  }
  return PaymentTier[result.rows[0].payment_tier] >= requiredTier;
};

// Get logged-in user profile
app.get("/api/users/profile", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const userResult = await pool.query(
      "SELECT id, name, username, email, avatar, bio, bio_visibility, interests_visibility, city, state, payment_tier FROM users WHERE id = $1",
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const user = userResult.rows[0];

    // Fetch interests based on payment tier
    let interestsResult;
    if (PaymentTier[user.payment_tier] >= PaymentTier.Basic) {
      interestsResult = await pool.query(
        `
        SELECT i.id, i.category, i.visibility, 
               json_agg(json_build_object('id', it.id, 'name', it.name, 'rating', it.rating)) AS items
        FROM interests i
        LEFT JOIN items it ON i.id = it.interest_id
        WHERE i.user_id = $1
        GROUP BY i.id
      `,
        [userId]
      );
      user.interests = interestsResult.rows;
    } else {
      // For Free tier, limit to 3 categories and 5 items per category
      interestsResult = await pool.query(
        `
        SELECT i.id, i.category, i.visibility, 
               (SELECT json_agg(json_build_object('id', it.id, 'name', it.name, 'rating', it.rating))
                FROM (SELECT * FROM items WHERE interest_id = i.id LIMIT 5) it) AS items
        FROM interests i
        WHERE i.user_id = $1
        LIMIT 3
      `,
        [userId]
      );
      user.interests = interestsResult.rows;
    }

    res.json(user);
  } catch (error) {
    console.error("Error fetching profile:", error);
    res.status(500).json({ message: "Server error" });
  }
});

app.put("/api/users/:userId/profile", authMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    const { name, username, bio, city, state, bio_visibility } = req.body;

    // Ensure the logged-in user can only edit their own profile
    if (parseInt(userId) !== req.user.id) {
      return res
        .status(403)
        .json({ message: "Not authorized to edit this profile" });
    }

    const result = await pool.query(
      `UPDATE users 
       SET name = $1, username = $2, bio = $3, city = $4, state = $5, bio_visibility = $6
       WHERE id = $7
       RETURNING *`,
      [name, username, bio, city, state, bio_visibility, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const updatedUser = result.rows[0];
    res.json(updatedUser);
  } catch (error) {
    console.error("Error updating user profile:", error);
    res.status(500).json({ message: "Server error" });
  }
});

app.put(
  "/api/users/:userId/profile-picture",
  authMiddleware,
  async (req, res) => {
    try {
      const { userId } = req.params;
      const { avatar } = req.body;

      // Ensure the logged-in user can only edit their own profile
      if (parseInt(userId) !== req.user.id) {
        return res
          .status(403)
          .json({ message: "Not authorized to edit this profile" });
      }

      const result = await pool.query(
        `UPDATE users 
       SET avatar = $1
       WHERE id = $2
       RETURNING *`,
        [avatar, userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ message: "User not found" });
      }

      const updatedUser = result.rows[0];
      res.json(updatedUser);
    } catch (error) {
      console.error("Error updating user profile picture:", error);
      res.status(500).json({ message: "Server error", details: error.message });
    }
  }
);

app.post("/api/interests", authMiddleware, async (req, res) => {
  try {
    const { category, visibility } = req.body;
    const userId = req.user.id;

    const result = await pool.query(
      "INSERT INTO interests (user_id, category, visibility) VALUES ($1, $2, $3) RETURNING id, user_id, category, visibility",
      [userId, category, visibility]
    );

    const newInterest = result.rows[0];

    // Return the new interest with an empty items array
    const interest = {
      ...newInterest,
      items: [], // Empty array instead of array with null item
    };

    res.status(201).json(interest);
  } catch (error) {
    console.error("Error adding interest category:", error);
    res
      .status(500)
      .json({ message: "Server error while adding interest category" });
  }
});

app.delete("/api/interests/:categoryId", authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    const { categoryId } = req.params;
    const userId = req.user.id;

    await client.query("BEGIN");

    // Check if the category belongs to the user
    const categoryCheck = await client.query(
      "SELECT * FROM interests WHERE id = $1 AND user_id = $2",
      [categoryId, userId]
    );

    if (categoryCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(403).json({ message: "Unauthorized" });
    }

    // Delete the category (items will be cascade deleted due to foreign key constraint)
    await client.query("DELETE FROM interests WHERE id = $1", [categoryId]);

    await client.query("COMMIT");

    res.status(204).send();
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error deleting category:", error);
    res.status(500).json({ message: "Server error while deleting category" });
  } finally {
    client.release();
  }
});

app.delete(
  "/api/interests/:categoryId/items/:itemId",
  authMiddleware,
  async (req, res) => {
    try {
      const { categoryId, itemId } = req.params;
      const userId = req.user.id;

      // Ensure the category belongs to the user
      const categoryCheck = await pool.query(
        "SELECT * FROM interests WHERE id = $1 AND user_id = $2",
        [categoryId, userId]
      );

      if (categoryCheck.rows.length === 0) {
        return res.status(403).json({ message: "Unauthorized" });
      }

      // Delete the item
      await pool.query("DELETE FROM items WHERE id = $1 AND interest_id = $2", [
        itemId,
        categoryId,
      ]);

      res.status(204).send();
    } catch (error) {
      console.error("Error removing item:", error);
      res.status(500).json({ message: "Server error while removing item" });
    }
  }
);

app.get("/users", authMiddleware, async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM users");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/users/not-friends", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    const query = `
      SELECT id, name, username, email, avatar
      FROM users
      WHERE id != $1
      AND id NOT IN (
        SELECT friend_id
        FROM friends
        WHERE user_id = $1
      )
    `;

    const result = await pool.query(query, [userId]);

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching non-friend users:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Get all users
app.get("/api/users", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, name, username, email, avatar FROM users"
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Get user by id
app.get("/api/users/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "SELECT id, name, username, email, avatar FROM users WHERE id = $1",
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Get interests for a user
app.get("/api/users/:id/interests", authMiddleware, (req, res) => {
  const userInterests = interests.filter(
    (i) => i.userId === parseInt(req.params.id)
  );
  res.json(userInterests);
});

app.get("/api/friends", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    // Check if user has access to friends list
    const hasAccess = await checkPaymentTier(userId, PaymentTier.Basic);
    if (!hasAccess) {
      return res
        .status(403)
        .json({ message: "Upgrade required to access friends list" });
    }

    const query = `
      SELECT u.id, u.name, u.username, u.avatar
      FROM users u
      INNER JOIN friends f ON u.id = f.friend_id
      WHERE f.user_id = $1
    `;

    const result = await pool.query(query, [userId]);

    // For Basic tier, limit to 10 friends
    const friends = result.rows.slice(
      0,
      PaymentTier[req.user.payment_tier] === PaymentTier.Basic ? 10 : undefined
    );

    res.json(friends);
  } catch (error) {
    console.error("Error fetching friends:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Update the POST /api/friend-requests endpoint in server.js

app.post("/api/friend-requests", authMiddleware, async (req, res) => {
  try {
    const senderId = req.user.id; // ID of the user sending the request
    const { receiverId } = req.body; // ID of the user receiving the request

    // Check if a friend request already exists
    const checkQuery =
      "SELECT * FROM friend_requests WHERE sender_id = $1 AND receiver_id = $2";
    const checkResult = await pool.query(checkQuery, [senderId, receiverId]);

    if (checkResult.rows.length > 0) {
      return res.status(400).json({ message: "Friend request already sent" });
    }

    // Get sender's full name
    const senderQuery = "SELECT name FROM users WHERE id = $1";
    const senderResult = await pool.query(senderQuery, [senderId]);
    const senderName = senderResult.rows[0].name;

    // Insert new friend request
    const insertQuery =
      "INSERT INTO friend_requests (sender_id, receiver_id, status) VALUES ($1, $2, 'pending') RETURNING *";
    const insertResult = await pool.query(insertQuery, [senderId, receiverId]);

    // Create a notification for the receiver
    await createNotification(
      receiverId, // Correctly using receiverId here
      `You have a new friend request from ${senderName}`,
      "friend_request"
    );

    res.status(201).json(insertResult.rows[0]);
  } catch (error) {
    console.error("Error sending friend request:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Update the createNotification function if it's separate
const createNotification = async (userId, content, type) => {
  try {
    const query =
      "INSERT INTO notifications (user_id, content, type) VALUES ($1, $2, $3) RETURNING *";
    const result = await pool.query(query, [userId, content, type]);
    return result.rows[0];
  } catch (error) {
    console.error("Error creating notification:", error);
    throw error;
  }
};

// Get friend requests for a user
app.get("/api/friend-requests", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const query = `
      SELECT fr.id, fr.sender_id, fr.status, u.name, u.username, u.avatar
      FROM friend_requests fr
      JOIN users u ON fr.sender_id = u.id
      WHERE fr.receiver_id = $1 AND fr.status = 'pending'
    `;
    const result = await pool.query(query, [userId]);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching friend requests:", error);
    res.status(500).json({ message: "Server error" });
  }
});

app.put("/api/friend-requests/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // 'accepted' or 'rejected'
    const userId = req.user.id;

    // Update friend request status
    const updateQuery =
      "UPDATE friend_requests SET status = $1 WHERE id = $2 AND receiver_id = $3 RETURNING *";
    const result = await pool.query(updateQuery, [status, id, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Friend request not found" });
    }

    const friendRequest = result.rows[0];

    // If accepted, add to friends list
    if (status === "accepted") {
      const addFriendQuery =
        "INSERT INTO friends (user_id, friend_id) VALUES ($1, $2), ($2, $1)";
      await pool.query(addFriendQuery, [userId, friendRequest.sender_id]);

      // Get names for both users
      const namesQuery = "SELECT id, name FROM users WHERE id = $1 OR id = $2";
      const namesResult = await pool.query(namesQuery, [
        userId,
        friendRequest.sender_id,
      ]);
      const names = namesResult.rows.reduce(
        (acc, user) => ({ ...acc, [user.id]: user.name }),
        {}
      );

      // Create notifications for both users
      await createNotification(
        userId,
        `You are now friends with ${names[friendRequest.sender_id]}`,
        "friend_accepted"
      );
      await createNotification(
        friendRequest.sender_id,
        `${names[userId]} has accepted your friend request`,
        "friend_accepted"
      );
    }

    res.json({ message: `Friend request ${status}` });
  } catch (error) {
    console.error("Error updating friend request:", error);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/api/notifications", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    console.log(userId);
    const query =
      "SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC";
    const result = await pool.query(query, [userId]);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({ message: "Server error" });
  }
});

app.put("/api/notifications/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const query =
      "UPDATE notifications SET read = true WHERE id = $1 AND user_id = $2 RETURNING *";
    const result = await pool.query(query, [id, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Notification not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error updating notification:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Add a new interest
app.post("/api/interests", authMiddleware, (req, res) => {
  const { userId, category, item, rating } = req.body;
  const newInterest = {
    id: interests.length + 1,
    userId: parseInt(userId),
    category,
    item,
    rating: parseInt(rating),
  };
  interests.push(newInterest);
  res.status(201).json(newInterest);
});

app.post(
  "/api/interests/:categoryId/items",
  authMiddleware,
  async (req, res) => {
    const client = await pool.connect();
    try {
      const { categoryId } = req.params;
      const { name, rating } = req.body;
      const userId = req.user.id;

      await client.query("BEGIN");

      // Check if the category belongs to the user
      const categoryCheck = await client.query(
        "SELECT * FROM interests WHERE id = $1 AND user_id = $2",
        [categoryId, userId]
      );

      if (categoryCheck.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(403).json({ message: "Unauthorized" });
      }

      // Validate input
      if (!name || name.trim() === "") {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "Item name is required" });
      }

      if (!rating || rating < 1 || rating > 10) {
        await client.query("ROLLBACK");
        return res
          .status(400)
          .json({ message: "Rating must be between 1 and 10" });
      }

      // Insert the new item
      const result = await client.query(
        "INSERT INTO items (interest_id, name, rating) VALUES ($1, $2, $3) RETURNING id, name, rating",
        [categoryId, name.trim(), rating]
      );

      const newItem = result.rows[0];

      await client.query("COMMIT");

      res.status(201).json(newItem);
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Error adding item:", error);
      res.status(500).json({ message: "Server error while adding item" });
    } finally {
      client.release();
    }
  }
);

app.put(
  "/api/interests/:categoryId/items/:itemId",
  authMiddleware,
  async (req, res) => {
    const client = await pool.connect();
    try {
      const { categoryId, itemId } = req.params;
      const { rating } = req.body;
      const userId = req.user.id;

      await client.query("BEGIN");

      // Check if the category belongs to the user
      const categoryCheck = await client.query(
        "SELECT * FROM interests WHERE id = $1 AND user_id = $2",
        [categoryId, userId]
      );

      if (categoryCheck.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(403).json({ message: "Unauthorized" });
      }

      // Validate input
      if (rating === undefined || rating < 1 || rating > 10) {
        await client.query("ROLLBACK");
        return res
          .status(400)
          .json({ message: "Rating must be between 1 and 10" });
      }

      // Update the item rating
      const result = await client.query(
        "UPDATE items SET rating = $1 WHERE id = $2 AND interest_id = $3 RETURNING id, name, rating",
        [rating, itemId, categoryId]
      );

      if (result.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Item not found" });
      }

      const updatedItem = result.rows[0];

      await client.query("COMMIT");

      res.json(updatedItem);
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Error updating item rating:", error);
      res
        .status(500)
        .json({ message: "Server error while updating item rating" });
    } finally {
      client.release();
    }
  }
);

app.get("/api/recommendations", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    // Check if user has access to recommendations
    const hasAccess = await checkPaymentTier(userId, PaymentTier.Premium);
    if (!hasAccess) {
      return res
        .status(403)
        .json({ message: "Upgrade to Premium to access recommendations" });
    }

    // Implement your recommendation logic here
    // For now, we'll return dummy data
    const recommendations = [
      {
        id: 1,
        category: "Books",
        item: "The Hitchhiker's Guide to the Galaxy",
        description:
          "A sci-fi comedy classic that matches your interest in humorous literature and space exploration.",
        rating: 4.5,
      },
    ];

    res.json(recommendations);
  } catch (error) {
    console.error("Error fetching recommendations:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
