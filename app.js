var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
const cors = require('cors');
const logger = require('morgan');
require('module-alias/register');

const indexRouter = require('./routes/index');
const usersRouter = require('./routes/users');
const paramRouter = require('./routes/parameters');
const productRouter = require('./routes/product');
const productCategoryRouter = require('./routes/productCategory');
const cartRouter = require('./routes/cart');
const orderRouter = require('./routes/order');
const questionRouter = require('./routes/question');
const bannerRouter = require('./routes/banner');
const ecpaymentRouter = require('./routes/ecpayment');
const logisticRouter = require('./routes/logistic');

const app = express();
require('dotenv').config();
// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use(cors({
  origin: [`${process.env.ADMIN_SYSTEM_URL}`, `${process.env.CUSTOMER_SYSTEM_URL}`],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
}));

app.use('/', indexRouter);
app.use('/users', usersRouter);
app.use('/param', paramRouter);
app.use('/product', productRouter);
app.use('/productCategory', productCategoryRouter);
app.use('/cart', cartRouter);
app.use('/order', orderRouter);
app.use('/question', questionRouter);
app.use('/banner', bannerRouter);
app.use('/ecpayment', ecpaymentRouter);
app.use('/logistic', logisticRouter);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
