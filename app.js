const express = require('express')
const path = require('path')
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')

const app = express()
app.use(express.json())

const dbpath = path.join(__dirname, 'twitterClone.db')
let db = null

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbpath,
      driver: sqlite3.Database,
    })
    app.listen(3000, () => {
      console.log('Server running at localhost 3000')
    })
  } catch (error) {
    console.log(`DB Error:${error.message}`)
    process.exit(1)
  }
}

initializeDBAndServer()

const authToken = (req, res, next) => {
  let jwtToken
  const authHeader = req.headers['authorization']
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(' ')[1]
  }
  if (jwtToken === undefined) {
    res.status(401)
    res.send('Invalid JWT Token')
  } else {
    jwt.verify(jwtToken, 'MY_SECRET_TOKEN', async (error, payload) => {
      if (error) {
        res.status(401)
        res.send('Invalid JWT Token')
      } else {
        req.headers.username = payload.username
        next()
      }
    })
  }
}

app.post('/register/', async (req, res) => {
  const {username, password, name, gender} = req.body
  const query1 = `SELECT * FROM user WHERE username='${username}'`
  const dbUser = await db.get(query1)
  if (dbUser === undefined) {
    if (password.length < 6) {
      res.status(400)
      res.send('Password is too short')
    } else {
      const hashedPassword = await bcrypt.hash(password, 10)
      const registerQuery = `INSERT INTO user(username,password,name,gender) VALUES ('${username}','${hashedPassword}','${name}','${gender}')`
      await db.run(registerQuery)
      res.status(200)
      res.send('User created successfully')
    }
  } else {
    res.status(400)
    res.send('User already exists')
  }
})

app.post('/login/', async (req, res) => {
  const {username, password} = req.body
  const payload = {username}
  const jwtToken = jwt.sign(payload, 'MY_SECRET_TOKEN')
  const query2 = `SELECT * FROM user WHERE username='${username}'`
  const dbUser = await db.get(query2)
  if (dbUser === undefined) {
    res.status(400)
    res.send('Invalid user')
  } else {
    const passwordMatches = await bcrypt.compare(password, dbUser.password)
    if (passwordMatches) {
      res.send({jwtToken})
    } else {
      res.status(400)
      res.send('Invalid password')
    }
  }
})

app.get('/user/tweets/feed/', authToken, async (req, res) => {
  const {username} = req.headers
  const getUser = `SELECT * FROM user WHERE username='${username}'`
  const dbUser = await db.get(getUser)
  const userId = dbUser['user_id']
  const query3 = `SELECT username,tweet,date_time AS dateTime FROM follower INNER JOIN tweet ON follower.following_user_id=tweet.user_id 
  NATURAL JOIN user WHERE follower.follower_user_id='${userId}' ORDER BY dateTime desc LIMIT 4`
  const dbResponse = await db.all(query3)
  res.send(dbResponse)
})

app.get('/user/following/', authToken, async (req, res) => {
  const {username} = req.headers
  const getUser = `SELECT * FROM user WHERE username='${username}'`
  const dbUser = await db.get(getUser)
  const userId = dbUser['user_id']
  const query4 = `SELECT name FROM follower INNER JOIN user ON follower.following_user_id=user.user_id 
  WHERE follower_user_id='${userId}'`
  const dbResponse = await db.all(query4)
  res.send(dbResponse)
})

app.get('/user/followers/', authToken, async (req, res) => {
  const {username} = req.headers
  const getUser = `SELECT * FROM user WHERE username='${username}'`
  const dbUser = await db.get(getUser)
  const userId = dbUser['user_id']
  const query5 = `SELECT name FROM follower INNER JOIN user ON follower.follower_user_id=user.user_id
  WHERE following_user_id='${userId}'`
  const dbResponse = await db.all(query5)
  res.send(dbResponse)
})

const userFollowingAuthenticate = async (req, res, next) => {
  const {tweetId} = req.params
  const {username} = req.headers
  const getUserQuery = `SELECT * FROM user WHERE username='${username}'`
  const dbUser = await db.get(getUserQuery)
  const userId = dbUser['user_id']

  const followQuery = `SELECT following_user_id FROM follower WHERE follower_user_id='${userId}'`
  const followResponse = await db.all(followQuery)

  const tweetsQuery = `SELECT * FROM tweet WHERE tweet_id='${tweetId}'`
  const tweetsResponse = await db.get(tweetsQuery)
  const tweetUserId = tweetsResponse['user_id']

  let tweeetUserFollowing = false
  followResponse.forEach(each => {
    if (each['following_user_id'] === tweetUserId) {
      tweeetUserFollowing = true
    }
  })
  if (tweeetUserFollowing) {
    next()
  } else {
    res.status(401)
    res.send('Invalid Request')
  }
}

app.get(
  '/tweets/:tweetId/',
  authToken,
  userFollowingAuthenticate,
  async (req, res) => {
    const {tweetId} = req.params
    const query6 = `SELECT tweet, COUNT() AS replies, date_time AS dateTime FROM tweet INNER JOIN reply
    ON tweet.tweet_id = reply.tweet_id WHERE tweet.tweet_id = '${tweetId}'`
    const dbResponse = await db.get(query6)

    const likesQuery = `SELECT COUNT() AS likes FROM like WHERE tweet_id='${tweetId}'`
    const {likes} = await db.get(likesQuery)
    dbResponse.likes = likes
    res.send(dbResponse)
  },
)

app.get(
  '/tweets/:tweetId/likes/',
  authToken,
  userFollowingAuthenticate,
  async (req, res) => {
    const {tweetId} = req.params
    const query7 = `SELECT username FROM like NATURAL JOIN user WHERE tweet.tweet_id='${tweetId}'`
    const dbResponse = await db.all(query7)
    const usernames = dbResponse.map(each => each.username)
    res.send({likes: usernames})
  },
)

app.get(
  '/tweets/:tweetId/replies/',
  authToken,
  userFollowingAuthenticate,
  async (req, res) => {
    const {tweetId} = req.params
    const query8 = `SELECT name,reply FROM reply NATURAL JOIN user WHERE tweet_id='${tweetId}'`
    const dbResponse = await db.all(query8)
    res.send({replies: dbResponse})
  },
)

app.get('/user/tweets/', authToken, async (req, res) => {
  const {username} = req.headers
  const getUser = `SELECT * FROM user WHERE username='${username}'`
  const dbUser = await db.get(getUser)
  const userId = dbUser['user_id']
  const likeQuery = `SELECT tweet,count() AS likes,date_time as dateTime FROM tweet INNER JOIN like
  ON tweet.tweet_id=like.tweet_id WHERE tweet.user_id='${userId}' GROUP BY tweet.tweet_id`
  const likesResponse = await db.all(likeQuery)
  const repliesQuery = `SELECT tweet,COUNT() AS replies FROM tweet INNER JOIN reply ON tweet.tweet_id=reply.tweet_id 
  WHERE tweet.user_id='${userId}' GROUP BY tweet.tweet_id`
  const repliesResponse = await db.all(repliesQuery)
  likesResponse.forEach(each => {
    for (let data of repliesResponse) {
      if (each.tweet === data.tweet) {
        each.replies = data.replies
        break
      }
    }
  })
  res.send(likesResponse)
})

app.post('/user/tweets/', authToken, async (req, res) => {
  const {tweet} = req.body
  const {username} = req.headers
  const getUser = `SELECT * FROM user WHERE username='${username}'`
  const dbUser = await db.get(getUser)
  const userId = dbUser['user_id']
  const quey10 = `INSERT INTO tweet(tweet,user_id) VALUES('${tweet}','${userId}')`
  await db.run(quey10)
  res.send('Created a Tweet')
})

app.delete('/tweets/:tweetId/', authToken, async (req, res) => {
  const {tweetId} = req.params
  const {username} = req.headers
  const getUser = `SELECT * FROM user WHERE username='${username}'`
  const dbUser = await db.get(getUser)
  const userId = dbUser['user_id']
  const query11 = `SELECT tweet_id,user_id FROM tweet WHERE user_id='${userId}'`
  const dbResponse = await db.all(query11)

  let tweetUser = false
  dbResponse.forEach(each => {
    if (each['tweet_id'] === parseInt(tweetId)) {
      tweetUser = true
    }
  })

  if (tweetUser) {
    const deleteQuery = `DELETE FROM tweet WHERE tweet_id='${tweetId}'`
    await db.run(deleteQuery)
    res.send('Tweet Removed')
  } else {
    res.status(401)
    res.send('Invalid Request')
  }
})

module.exports = app
