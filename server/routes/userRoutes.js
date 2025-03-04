const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth");
const pool = require("../db");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
// const { checkPromptLimit } = require("../utils/miscUtils.js");
const bcrypt = require("bcrypt");

// const PaymentTier = {
//   Owner: 1,
//   Premium: 2,
//   Basic: 3,
//   Free: 4,
// };

// router.get("/profile", authMiddleware, checkPromptLimit, async (req, res) => {
router.get("/profile", authMiddleware, async (req, res) => {
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
    // if (PaymentTier[user.payment_tier] <= PaymentTier.Basic) {
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
    // } else {
    //   // For Free tier, limit to 3 categories and 5 items per category
    //   interestsResult = await pool.query(
    //     `
    //     SELECT i.id, i.category, i.visibility,
    //            (SELECT json_agg(json_build_object('id', it.id, 'name', it.name, 'rating', it.rating))
    //             FROM (SELECT * FROM items WHERE interest_id = i.id LIMIT 5) it) AS items
    //     FROM interests i
    //     WHERE i.user_id = $1
    //     LIMIT 3
    //   `,
    //     [userId]
    //   );
    //   user.interests = interestsResult.rows;
    // }

    res.json(user);
  } catch (error) {
    console.error("Error fetching profile:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.put("/:userId/profile", authMiddleware, async (req, res) => {
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

router.put("/:userId/profile-picture", authMiddleware, async (req, res) => {
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
});

router.post("/close-account", authMiddleware, async (req, res) => {
  const userId = req.user.id;

  try {
    // Start a transaction
    await pool.query("BEGIN");

    // Fetch user data
    const userResult = await pool.query("SELECT * FROM users WHERE id = $1", [
      userId,
    ]);
    const user = userResult.rows[0];

    if (!user) {
      await pool.query("ROLLBACK");
      return res.status(404).json({ message: "User not found" });
    }

    // Check for active Stripe subscription
    if (user.stripe_customer_id) {
      const subscriptions = await stripe.subscriptions.list({
        customer: user.stripe_customer_id,
        status: "active",
      });

      // Cancel active subscription if exists
      if (subscriptions.data.length > 0) {
        await stripe.subscriptions.cancel(subscriptions.data[0].id);
      }

      // Optionally, you might want to delete the Stripe customer as well
      await stripe.customers.del(user.stripe_customer_id);
    }

    // Delete user from the database
    await pool.query("DELETE FROM users WHERE id = $1", [userId]);

    // Commit the transaction
    await pool.query("COMMIT");

    res.json({ message: "Account closed successfully" });
  } catch (error) {
    await pool.query("ROLLBACK");
    console.error("Error closing account:", error);
    res.status(500).json({ message: "Error closing account" });
  }
});

router.get("/not-friends", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    const query = `
    SELECT u.id, u.name, u.username, u.email, u.avatar,
           CASE
             WHEN fr.status IS NOT NULL THEN json_build_object('status', fr.status, 'requestId', fr.id)
             ELSE NULL
           END AS friend_request_status
    FROM users u
    LEFT JOIN friend_requests fr ON (fr.sender_id = $1 AND fr.receiver_id = u.id) OR (fr.receiver_id = $1 AND fr.sender_id = u.id)
    WHERE u.id != $1
    AND u.id NOT IN (
      SELECT friend_id
      FROM friends
      WHERE user_id = $1
    )
    `;

    // const query = `
    // SELECT u.id, u.name, u.username, u.email, u.avatar,
    //        CASE
    //          WHEN fr.status IS NOT NULL THEN json_build_object('status', fr.status, 'requestId', fr.id)
    //          ELSE NULL
    //        END AS friend_request_status
    // FROM users u
    // LEFT JOIN friend_requests fr ON (fr.sender_id = $1 AND fr.receiver_id = u.id) OR (fr.receiver_id = $1 AND fr.sender_id = u.id)
    // WHERE u.id != $1
    // AND u.payment_tier != 'Free'::payment_tier_enum
    // AND u.id NOT IN (
    //   SELECT friend_id
    //   FROM friends
    //   WHERE user_id = $1
    // )
    // `;

    const result = await pool.query(query, [userId]);

    const usersWithRequestStatus = result.rows.map((user) => ({
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      avatar: user.avatar,
      friendRequestStatus: user.friend_request_status,
    }));

    res.json(usersWithRequestStatus);
  } catch (error) {
    console.error("Error fetching non-friend users:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/:id/interests", authMiddleware, (req, res) => {
  const userInterests = interests.filter(
    (i) => i.userId === parseInt(req.params.id)
  );
  res.json(userInterests);
});

module.exports = router;
