const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
app.use(bodyParser.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const mongoURI = 'mongodb://127.0.0.1:27017/site_encomendas';

mongoose.connect(mongoURI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log('Connected to MongoDB');
}).catch(err => {
    console.error('Failed to connect to MongoDB', err);
});

const userSchema = new mongoose.Schema({
    username: String,
    password: String
});

const User = mongoose.model('User', userSchema);

// Mock menu items
const menuItems = [
    { _id: '1', name: 'Salgado', description: 'Delicioso salgado', price: 5 },
    { _id: '2', name: 'Doce', description: 'Delicioso doce', price: 3 },
    { _id: '3', name: 'Bebida', description: 'Deliciosa bebida', price: 2 }
];

// Armazena os carrinhos na memória (não é persistente, apenas para desenvolvimento)
let cartMemory = {};

// Register route
app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ username, password: hashedPassword });
    await user.save();
    res.redirect('/login.html');
});

// Login route
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (user && await bcrypt.compare(password, user.password)) {
        const token = jwt.sign({ username: user.username }, 'secretkey');
        res.json({ token });
    } else {
        res.status(401).send('Invalid credentials');
    }
});

// Middleware to check authentication
function checkAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) return res.status(401).json({ message: 'Unauthorized' });

    jwt.verify(token, 'secretkey', (err, user) => {
        if (err) return res.status(403).json({ message: 'Forbidden' });
        req.user = user;
        next();
    });
}

// Get menu items
app.get('/menu', (req, res) => {
    res.json(menuItems);
});

// Add to cart route
app.post('/add-to-cart', checkAuth, (req, res) => {
    const { itemId } = req.body;
    const cart = cartMemory[req.user.username] || [];
    const item = menuItems.find(menuItem => menuItem._id === itemId);

    if (item) {
        const cartItem = cart.find(cartItem => cartItem._id === itemId);
        if (cartItem) {
            cartItem.quantity++;
        } else {
            cart.push({ ...item, quantity: 1 });
        }
    }
    cartMemory[req.user.username] = cart;
    res.json({ message: 'Item added to cart' });
});

// Remove item from cart route
app.post('/remove-from-cart', checkAuth, (req, res) => {
    const { itemId } = req.body;
    let cart = cartMemory[req.user.username] || [];
    cart = cart.filter(item => item._id !== itemId);
    cartMemory[req.user.username] = cart;
    res.json({ message: 'Item removed from cart' });
});

// Place order route
app.post('/order', checkAuth, (req, res) => {
    const cart = cartMemory[req.user.username] || [];
    const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    let orderDetails = 'Order Details:\n';
    cart.forEach(item => {
        orderDetails += `${item.name} - ${item.quantity} x $${item.price} = $${item.quantity * item.price}\n`;
    });
    orderDetails += `Total: $${total}`;

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: '',
            pass: ''
        }
    });

    const mailOptions = {
        from: '',
        to: '',
        subject: 'New Order',
        text: orderDetails
    };

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.error('Error sending email:', error);
            res.status(500).send('Error placing order');
        } else {
            console.log('Email sent:', info.response);
            res.status(200).send('Order placed successfully');
        }
    });

    // Clear the cart after placing the order
    cartMemory[req.user.username] = [];
});

// Serve HTML files
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/login.html'));
});

app.get('/register.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/register.html'));
});

app.get('/menu.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/menu.html'));
});

app.get('/cart.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/cart.html'));
});

// Handle favicon requests
app.get('/favicon.ico', (req, res) => {
    res.status(404).send();
});

// Rota para criar um pagamento
app.post('/create-payment-intent', async (req, res) => {
    try {
        const { total } = req.body;

        if (!total || total <= 0) {
            return res.status(400).json({ error: 'Valor inválido para o pagamento' });
        }

        const session = await stripe.checkout.sessions.create({
            line_items: [{
                price_data: {
                    currency: 'eur',
                    product_data: {
                        name: 'Pedido Realizado',
                    },
                    unit_amount: total * 100, // Total enviado pelo front-end, convertido para centavos
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: `${process.env.BASE_URL}/menu.html?payment_status=success`,
            cancel_url: `${process.env.BASE_URL}/menu.html?payment_status=cancel`,
        });

        // Redireciona para a URL de checkout do Stripe
        res.json({ url: session.url });
        console.log(session);

    } catch (error) {
        console.error('Erro ao criar a sessão de pagamento:', error);
        res.status(500).json({ error: 'Erro ao criar a sessão de pagamento' });
    }
});

app.get('/complet', (req, res) => {
    res.send('ok');
});

app.get('/cancel', (req, res) => {
    res.send('null');
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
