const express = require('express');
const redis = require('ioredis');

const client = redis.createClient({
    port: 6379,
    host: 'localhost'
});

client.on('connect', function () {
    console.log('connected')
});

const LIMIT = 10;
const EXP_SECONDS = 10;
const WINDOW_SEC = 20;

const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => res.send('Hello World!'));
app.listen(port, () => console.log(`Example app listening at http://localhost:${port}`));

// * sliding window algo *
// increment counter for IP
// set new expiration for counter based on window
// check if counter is over limit, if so return true
// if not over limit return false, set expiration after x seconds for cache
async function isOverLimitSlidingWindow(ip) {

    let res;

    try {
        res = await client.incr(ip);
    } catch (err) {
        throw err;
    }

    console.log(`${ip} has value: ${res}`);
    
    if (res > LIMIT) {
        return true;
    }

    client.expire(ip, EXP_SECONDS);
    return false;
}

// * token bucket algo * 
// If haven't seen IP, return false, set up new counter with timestamp
// if timestamp is in past, window is over, set new counter up, return false
// else if tokens are greater than 0, decrement tokens and update cache, return false
// else no available tokens, return true and block requests 
async function isOverLimitTokenBucket(ip) {

    let seen = await client.get(ip);
    if (!seen) {
        console.log(`never seen ${ip} before, setting up tokens`);
        await client.set(ip, 10);
        await client.set(ip + "_ts", +new Date());
        return false;
    }

    let tokens = await client.get(ip);
    let ts = await client.get(ip + "_ts");

    let windowStartTimeStamp = new Date(parseInt(ts));
    windowStartTimeStamp.setSeconds(windowStartTimeStamp.getSeconds() + WINDOW_SEC)

    // timestamp is in past - window is over
    if (new Date() > windowStartTimeStamp) {
        console.log(`our window is over, set new timestamp and get new tokens`);
        await client.set(ip, 10);
        await client.set(ip + "_ts", + new Date());
        return false;
    } else if (tokens > 0) {
        tokens = tokens - 1;
        await client.set(ip, tokens);
        console.log(`remaining tokens: ${tokens}`);
        return false;
    } else {
        console.log(`no available tokens: ${ip}`);
        console.log('current time', new Date());
        console.log('window timestamp', windowStartTimeStamp);
        return true;
    }
}

app.post('/', async (req, res) => {
    // check rate limit
    let overLimit = await isOverLimitTokenBucket(req.ip);

    if (overLimit) {
        res.status(429).send('Too many requests');
        return;
    }

    // allow
    res.send("OK!");
});