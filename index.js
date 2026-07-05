let express = require("express");
let path = require("path");
const cors = require("cors");
const { Pool } = require("pg");
require("dotenv").config();
const { DATABASE_URL } = process.env;
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

let app = express();
app.use(cors());
app.use(express.json())

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
})

async function getPostgresVersion() {
    const client = await pool.connect();
    try {
        const response = await client.query("SELECT version()")
        console.log(response.rows[0]);
    } finally {
        if (client) client.release()
    }
}

getPostgresVersion()

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
            'SELECT * FROM bookings WHERE user_id = $1',
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

app.put('/bookings/:id', async (req, res) => {
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
            WHERE id = $9 RETURNING*`)
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
                email: user.email
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
    const { email, password } = req.body

    try {

        if (!email || !password) {
            return res.status(400).json({ error: "Email and Password required" })
        }

        const hashPass = await bcrypt.hash(password, 10)
        const result = await client.query(`INSERT INTO users(email, password) VALUES ($1, $2) RETURNING id, email`, [email, hashPass])

        res.json(result.rows[0])
    } catch (error) {
        console.error(error);
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
    const { name, cuisine_type, capacity, location } = req.body
    try {
        const result = await client.query(
            'INSERT INTO restaurants (name, cuisine_type, capacity, location) VALUES($1, $2, $3, $4) RETURNING *',
            [name, cuisine_type, capacity, location]
        )
        res.json(result.rows[0])
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal server error" });
    } finally {
        if (client) client.release();
    }
})

app.delete('/restaurants/:id', async (req, res) => {
    const client = await pool.connect()
    try {
        const { id } = req.params
        const result = await client.query(`DELETE FROM restaurants WHERE id=$1 RETURNING *`, [id])

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Restaurant not found" });
        }
        res.json({ "status": "success", "message": "bookings successfully deleted" })
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

