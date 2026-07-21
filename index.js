let express = require("express");
let path = require("path");
const cors = require("cors");
const { Pool } = require("pg");
require("dotenv").config();

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { decode } = require("punycode");
const { json } = require("stream/consumers");
const axios = require('axios');

let app = express();
app.use(cors());
app.use(express.json())

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || "",
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});
async function getPostgresVersion() {
    // Only try to connect if we actually have a URL string
    if (!process.env.DATABASE_URL) {
        console.log("No DATABASE_URL found. Skipping connection check during build.");
        return;
    }

    try {
        const client = await pool.connect();
        const response = await client.query("SELECT version()");
        console.log(response.rows[0]);
        if (client) client.release();
    } catch (err) {
        console.error("Database connection failed:", err.message);
    }
}

getPostgresVersion();



app.post('/bookings', async (req, res) => {
    const client = await pool.connect()
    const { title, description, date, time, phone_number, email, user_id, restaurant_id } = req.body
    try {
        const result = await client.query(`INSERT INTO bookings (title, description, date, time, phone_number, email, user_id, restaurant_id)
            Values($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`, [title, description, date, time, phone_number, email, user_id, restaurant_id])
        res.json(result.rows[0])
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal server error" });
    } finally {
        if (client) client.release();
    }
})

app.get('/bookings', async (req, res) => {
    const client = await pool.connect();
    try {
        const token = req.headers.authorization?.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const result = await client.query(
            `SELECT bookings.*, restaurants.name as restaurant_name, restaurants.location as restaurant_location
       FROM bookings 
       LEFT JOIN restaurants ON bookings.restaurant_id = restaurants.id
       WHERE bookings.user_id = $1`,
            [decoded.id]
        );
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal server error" });
    } finally {
        if (client) client.release();
    }
});

app.get('/bookings/:id', async (req, res) => {
    const client = await pool.connect()

    try {
        const { id } = req.params
        const result = await client.query(`SELECT * FROM bookings WHERE id = $1`, [id])

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Booking not found" })
        }
        res.json(result.rows[0])

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal server error" });
    } finally {
        if (client) client.release();
    }
})

app.put('/bookings/:id/visited', async (req, res) => {

    const client = await pool.connect();
    try {
        const { id } = req.params;
        const result = await client.query(
            'UPDATE bookings SET visited = TRUE WHERE id = $1 RETURNING *',
            [id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Booking not found' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal server error" });
    } finally {
        if (client) client.release();
    }
});

app.put('/bookings/:id', async (req, res) => {
    console.log('PUT /bookings hit, id:', req.params.id);
    console.log('body:', req.body);
    const client = await pool.connect()
    const { id } = req.params
    const updatedData = req.body
    try {
        const updateQuery = (`UPDATE bookings  SET 
            title=$1,
            description=$2, 
            date=$3, 
            time=$4, 
            phone_number=$5, 
            email=$6, 
            user_id=$7, 
            restaurant_id=$8 
            WHERE id = $9 RETURNING *`)
        const queryData = [
            updatedData.title,
            updatedData.description,
            updatedData.date,
            updatedData.time,
            updatedData.phone_number,
            updatedData.email,
            updatedData.user_id,
            updatedData.restaurant_id,
            id
        ];
        const result = await client.query(updateQuery, queryData)

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Booking not found" });
        }
        res.json({ "status": "success", "message": "bookings successfully updated" })
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal server error" });
    } finally {
        if (client) client.release();
    }
})


app.delete('/bookings/:id', async (req, res) => {
    const client = await pool.connect()
    try {
        const { id } = req.params
        const result = await client.query(`DELETE FROM bookings WHERE id=$1 RETURNING *`, [id])

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Booking not found" });
        }
        res.json({ "status": "success", "message": "bookings successfully deleted" })
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal server error" });
    } finally {
        if (client) client.release();
    }
})

app.post('/login', async (req, res) => {
    const client = await pool.connect()
    const { email, password } = req.body
    try {
        const result = await client.query(`SELECT * FROM users WHERE email = $1`, [email])
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "User not found" })
        }
        const user = result.rows[0]

        // if (!user) {
        //     return res.status(400).json({ error: "Incorrect email and password" })
        // }

        const matchPass = await bcrypt.compare(password, user.password)
        if (!matchPass) {
            return res.status(401).json({ error: "Incorrect Password" })
        }

        const token = jwt.sign(
            {
                id: user.id,
                email: user.email,
                role: user.role    // added new role
            },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        )

        res.json({ message: "Login Successful", token, user: { id: user.id, email: user.email } })

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal server error" });
    } finally {
        if (client) client.release();
    }
})

app.post('/signup', async (req, res) => {
    const client = await pool.connect()
    const { email, password, first_name, last_name, birthday, phone_number } = req.body

    try {

        if (!email || !password) {
            return res.status(400).json({ error: "Email and Password required" })
        }

        const hashPass = await bcrypt.hash(password, 10)
        const result = await client.query(`INSERT INTO users(email, password, first_name, last_name, birthday, phone_number) 
            VALUES ($1, $2, $3, $4, $5, $6) 
            RETURNING id, email, first_name, last_name, birthday, phone_number`, [
            email,
            hashPass,
            first_name || null,
            last_name || null,
            birthday || null,
            phone_number || null
        ])

        res.json(result.rows[0])
    } catch (error) {
        console.error(error);

        if (error.code === '23505') {
            return res.status(400).json({ error: "An account with this email already exists." });
        }
        res.status(500).json({ error: "Internal server error" });
    } finally {
        if (client) client.release();
    }
})

app.get('/restaurants', async (req, res) => {
    const client = await pool.connect()
    try {
        const result = await client.query(`SELECT * FROM restaurants`)
        res.json(result.rows)
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal server error" });
    } finally {
        if (client) client.release();
    }
})

app.post('/restaurants', async (req, res) => {
    const client = await pool.connect()
    try {

        const { name, cuisine_type, capacity, location, menu_url } = req.body

        const geoRes = await axios.get('https://nominatim.openstreetmap.org/search', {
            params: {
                q: location,
                format: 'json',
                limit: 1
            },
            headers: {
                'User-Agent': 'SigmaServe/1.0'
            }
        })

        const lat = geoRes.data[0]?.lat || null
        const lng = geoRes.data[0]?.lon || null


        const result = await client.query(
            'INSERT INTO restaurants (name, cuisine_type, capacity, location,lat,lng, menu_url) VALUES($1, $2, $3, $4, $5, $6, $7) RETURNING *',
            [name, cuisine_type, capacity, location, lat, lng, menu_url]
        )
        res.json(result.rows[0])
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal server error" });
    } finally {
        if (client) client.release();
    }
})



app.put('/restaurants/:id', async (req, res) => {
    const client = await pool.connect()

    try {
        const token = req.headers.authorization?.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET)

        if (decoded.role !== 'admin') {
            return res.status(403).json({ error: 'Admin Access only' })
        }

        const { name, cuisine_type, capacity, location, menu_url } = req.body
        const { id } = req.params

        const geoRes = await axios.get('https://nominatim.openstreetmap.org/search', {
            params: {
                q: location,
                format: 'json',
                limit: 1
            },
            headers: {
                'User-Agent': 'SigmaServe/1.0'
            }
        })

        const lat = geoRes.data[0]?.lat || null
        const lng = geoRes.data[0]?.lon || null



        const result = await client.query(
            `UPDATE restaurants SET name= $1, cuisine_type=$2, capacity=$3, location=$4, lat=$5, lng=$6, menu_url=$7 WHERE id = $8 RETURNING*`,
            [name, cuisine_type, capacity, location, lat, lng, menu_url, id]
        )

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Restaurant not found' })
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal server error" });
    } finally {
        if (client) client.release();
    }
})

// app.delete('/restaurants/:id', async (req, res) => {
//     const client = await pool.connect()
//     try {
//         const { id } = req.params
//         const result = await client.query(`DELETE FROM restaurants WHERE id=$1 RETURNING *`, [id])

//         if (result.rows.length === 0) {
//             return res.status(404).json({ error: "Restaurant not found" });
//         }
//         res.json({ "status": "success", "message": "bookings successfully deleted" })
//     } catch (error) {
//         console.error(error);
//         res.status(500).json({ error: "Internal server error" });
//     } finally {
//         if (client) client.release();
//     }
// })


app.get('/admin/users', async (req, res) => {
    const client = await pool.connect();
    try {
        const token = req.headers.authorization?.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        if (decoded.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access only' });
        }

        const result = await client.query('SELECT id, email, role FROM users');
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal server error" });
    } finally {
        if (client) client.release();
    }
});

app.delete('/restaurants/:id', async (req, res) => {
    const client = await pool.connect();
    try {
        const token = req.headers.authorization?.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        if (decoded.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access only' });
        }

        const { id } = req.params;
        const result = await client.query(
            'DELETE FROM restaurants WHERE id=$1 RETURNING *',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Restaurant not found' });
        }

        res.json({ message: 'Restaurant deleted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal server error" });
    } finally {
        if (client) client.release();
    }
});

app.put('/users/:id', async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params
        const { profile_pic } = req.body

        const result = await client.query(`UPDATE users Set profile_pic = $1 WHERE id = $2 RETURNING id, email, profile_pic`,
            [profile_pic, id]
        )

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "User not found" })
        }
        res.json(result.rows[0])
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal server error" })
    } finally {
        if (client) client.release();
    }
});

app.get('/users/:id', async (req, res) => {
    const client = await pool.connect()
    try {
        const { id } = req.params
        const result = await client.query(
            `SELECT id, email, role, profile_pic FROM users WHERE id = $1`, [id]
        )
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "User not found" })
        }
        res.json(result.rows[0])
    } catch (error) {
        console.error(error)
        res.status(500).json({ error: "Internal server error" })
    } finally {
        if (client) client.release();
    }
})

app.get('/reviews/recent', async (req, res) => {
    const client = await pool.connect()
    try {
        const result = await client.query(`
            SELECT DISTINCT ON (reviews.id) reviews.*, 
                   users.first_name, 
                   restaurants.name as restaurant_name,
                   review_images.image_url
            FROM reviews
            JOIN users ON reviews.user_id = users.id
            JOIN restaurants ON reviews.restaurant_id = restaurants.id
            LEFT JOIN review_images ON reviews.id = review_images.review_id
            ORDER BY reviews.id, reviews.created_at DESC
            LIMIT 6
        `)
        res.json(result.rows)
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal server error" });
    } finally {
        if (client) client.release();
    }
})


app.get('/reviews/user/:user_id', async (req, res) => {
    const client = await pool.connect();
    try {
        const { user_id } = req.params;
        const result = await client.query(
            `SELECT reviews.*, 
                    restaurants.name as restaurant_name, 
                    restaurants.location as restaurant_location,
                    review_images.image_url
             FROM reviews
             JOIN restaurants ON reviews.restaurant_id = restaurants.id
             LEFT JOIN review_images ON reviews.id = review_images.review_id
             WHERE reviews.user_id = $1
             ORDER BY reviews.created_at DESC`,
            [user_id]
        );
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal server error" });
    } finally {
        if (client) client.release();
    }
});


app.post('/reviews/:id/images', async (req, res) => {
    const client = await pool.connect()
    try {
        const { id } = req.params
        const { image_url } = req.body

        const result = await client.query(
            'INSERT INTO review_images (review_id, image_url) VALUES ($1, $2) RETURNING *',
            [id, image_url]
        )
        res.json(result.rows[0])
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal server error" });
    } finally {
        if (client) client.release();
    }
})

app.get('/reviews/restaurant/:restaurant_id', async (req, res) => {
    const client = await pool.connect();
    try {
        const { restaurant_id } = req.params;
        const result = await client.query(`
            SELECT reviews.*, 
                   users.first_name,
                   review_images.image_url
            FROM reviews
            JOIN users ON reviews.user_id = users.id
            LEFT JOIN review_images ON reviews.id = review_images.review_id
            WHERE reviews.restaurant_id = $1
            ORDER BY reviews.created_at DESC
        `, [restaurant_id]);
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal server error" });
    } finally {
        if (client) client.release();
    }
});

app.post('/reviews', async (req, res) => {
    const client = await pool.connect()
    try {
        const { booking_id, user_id, restaurant_id, rating, comment } = req.body;
        const result = await client.query(
            'INSERT INTO reviews (booking_id, user_id, restaurant_id, rating, comment)  VALUES ($1, $2, $3, $4, $5) RETURNING *', [booking_id, user_id, restaurant_id, rating, comment]
        )
        res.json(result.rows[0])
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal server error" });
    } finally {
        if (client) client.release();
    }
})


app.put('/reviews/:id', async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params
        const { rating, comment } = req.body
        const result = await client.query('UPDATE reviews SET rating= $1, comment = $2 WHERE id = $3 RETURNING *', [rating, comment, id])
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal server error" });
    } finally {
        if (client) client.release();
    }
})


app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname + "/index.html"));
});

app.listen(3100, () => {
    console.log("App is listening on port 3100");
});

