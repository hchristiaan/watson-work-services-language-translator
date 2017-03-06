/*eslint-env node, express*/
// This application uses express as its web server
// for more info, see: http://expressjs.com

var express = require("express");
var request = require("request");
var crypto = require("crypto");

var APP_ID = process.env.APP_ID;
var APP_SECRET = process.env.APP_SECRET;
var WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

const WWS_URL = "https://api.watsonwork.ibm.com";
const AUTHORIZATION_API = "/oauth/token";
var WEBHOOK_VERIFICATION_TOKEN_HEADER = "X-OUTBOUND-TOKEN".toLowerCase();

//Keyword to "listen" for when receiving outbound webhook calls.
const webhookKeyword = "@tr";

// Language Translator
const LanguageTranslatorV2 = require('watson-developer-cloud/language-translator/v2');

const language_translator = new LanguageTranslatorV2({
	  username: '341590ba-43a8-434d-ad5c-f6539c19c2a0',
	  password: 'spQ8R0Rz1Bcj',
	  url: 'https://gateway.watsonplatform.net/language-translator/api/'
	});

// create a new express server
var app = express();

// serve the files out of ./public as our main files
app.use(express.static(__dirname + "/public"));

function rawBody(req, res, next) {
    var buffers = [];
    req.on("data", function(chunk) {
        buffers.push(chunk);
    });
    req.on("end", function() {
        req.rawBody = Buffer.concat(buffers);
        next();
    });
}

function errorHandler(err, req, res, next) {
    if (res.headersSent) {
        return next(err);
    }
    res.status(500);
    res.render("error", {
        error: err
    });
}

function verifySender(headers, rawbody) {
    var headerToken = headers[WEBHOOK_VERIFICATION_TOKEN_HEADER];
    var endpointSecret = WEBHOOK_SECRET;
    var expectedToken = crypto
        .createHmac("sha256", endpointSecret)
        .update(rawbody)
        .digest("hex");

    if (expectedToken === headerToken) {
        return Boolean(true);
    } else {
        return Boolean(false);
    }
}

function handleVerificationRequest(response, challenge) {
    var responseBodyObject = {
        "response": challenge
    };
    var responseBodyString = JSON.stringify(responseBodyObject);
    var endpointSecret = WEBHOOK_SECRET;

    var responseToken = crypto
        .createHmac("sha256", endpointSecret)
        .update(responseBodyString)
        .digest("hex");

    response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "X-OUTBOUND-TOKEN": responseToken
    });

    response.end(responseBodyString);
}

app.use(rawBody);
app.use(errorHandler);

app.listen(process.env.PORT || 3000, () => {
  console.log("INFO: app is listening on port: " + (process.env.PORT || 3000));
});

app.post("/webhook_callback", function(req, res) {
  
	// console.log("1. received callback");
	
  if (!APP_ID || !APP_SECRET || !WEBHOOK_SECRET) {
  	console.log("ERROR: Missing variables APP_ID, APP_SECRET or WEBHOOK_SECRET from environment");
  	return;
  }

  // console.log("APP_ID is : " + APP_ID );
  // console.log("APP_SECRET is : " + APP_SECRET );
  // console.log("WEBHOOK_SECRET is : " + WEBHOOK_SECRET );
  
  if (!verifySender(req.headers, req.rawBody)) {
      console.log("ERROR: Cannot verify caller! -------------");
      console.log(req.rawBody.toString());
      res.status(200).end();
      return;
  }
  
  // console.log("2. Sender verified once");

  var body = JSON.parse(req.rawBody.toString());
  var eventType = body.type;
  if (eventType === "verification") {
      handleVerificationRequest(res, body.challenge);
      console.log("INFO: Verification request processed");
      return;
  }
  
  // console.log("3. Sender verified second");

  // Acknowledge we received and processed notification to avoid getting sent the same event again
  res.status(200).end();

  if (eventType !== "message-created") {
    console.log("INFO: Skipping unwanted eventType: " + eventType);
    return;
  }
  
  // console.log("4. Message created event received " + eventType);
  
  var rcvMessage = body.content;
  var message = "";
  
  // console.log("5. INFO: message received: " + rcvMessage);
  
  if (rcvMessage.indexOf(webhookKeyword) !== 0) {
	  console.log("INFO: Skipping unwanted no keyword: " + webhookKeyword);
	    return;
  }

  // console.log("6. Message contained webhook keyword " + webhookKeyword);
  
  if (body.userId === APP_ID) {
    console.log("INFO: Skipping our own message Body: " + JSON.stringify(body));
    return;
  }
  
  // console.log("7. splitting the rcvmessage")

  const target = rcvMessage.split(' ')[1];
 // const target = rcvMessage.split(' ')[2];
  
  for (var i = 2; i < rcvMessage.split(" ").length; i++) {
	  message = message + ' ' + rcvMessage.split(" ")[i];
//	  console.log(i + ' ' + message );
  }
  
  const spaceId = body.spaceId;
  var messageId = body.messageId;
  
  console.log("Identifying language");
  
  language_translator.identify({ text: message},
		  function(err, identifiedLanguages) {
		    if (err) {
		      console.log(err);
		    } else {
		    //  console.log(identifiedLanguages);
		      translateMessage(identifiedLanguages,message,target,messageId,spaceId);
		    }
		});
});

  
  function translateMessage(identifiedLanguages,message,target,messageId,spaceId) {
	  var source = identifiedLanguages.languages[0].language;
		console.log("Source Language: " + source);
		
  console.log('Translating for text: \"' + message + '\" from ' + source + ' to ' + target);
  
  var msgTitle = "";
  var msgText = "";
  var memberName = "";
  var memberId = "";

 
  var result = ' ';
  var objResult = ' ';
  
 // var param = { 'text: ' + '\' + text + '}
  language_translator.translate(
		  {
		    text: message,
		    source: source,
		    target: target
		  },
		  function(err, translation) {
		    if (err) {
		      console.log('error:', err);
		    } else {
		    	continueWork(translation,messageId,spaceId);
		    }
		  }
		); 
  
}

function continueWork(translation,messageId,spaceId) {
  
  msgTitle = "Translation";
  msgText = translation.translations[0].translation;
  console.log("Translated text: " + msgText);

  // Build request options for authentication.
  const authenticationOptions = {
    "method": "POST",
    "url": `${WWS_URL}${AUTHORIZATION_API}`,
    "auth": {
        "user": APP_ID,
        "pass": APP_SECRET
    },
    "form": {
        "grant_type": "client_credentials"
    }
  };
  
  console.log("requesting authentication");

  request(authenticationOptions, function(err, response, authenticationBody) {

    // If successful authentication, a 200 response code is returned
    if (response.statusCode !== 200) {
        // if our app can't authenticate then it must have been disabled.  Just return
        console.log("ERROR: App can't authenticate");
        return;
    }
    const accessToken = JSON.parse(authenticationBody).access_token;

    const GraphQLOptions = {
        "url": `${WWS_URL}/graphql`,
        "headers": {
            "Content-Type": "application/graphql",
            "x-graphql-view": "PUBLIC",
            "jwt": "${jwt}"
        },
        "method": "POST",
        "body": ""
    };

    GraphQLOptions.headers.jwt = accessToken;
    GraphQLOptions.body = "{ message (id: \"" + messageId + "\") {createdBy { displayName id}}}";

    request(GraphQLOptions, function(err, response, graphqlbody) {

      if (!err && response.statusCode === 200) {
          const bodyParsed = JSON.parse(graphqlbody);
          var person = bodyParsed.data.message.createdBy;
					memberId = person.id;
          memberName = person.displayName;
          msgText = memberName + ': ' + msgText;

      } else {
          console.log("ERROR: Can't retrieve " + GraphQLOptions.body + " status:" + response.statusCode);
          return;
      }

      // Avoid endless loop of analysis :-)
			if (memberId !== APP_ID) {
        const appMessage = {
            "type": "appMessage",
            "version": "1",
            "annotations": [{
                "type": "generic",
                "version": "1",

                "title": "",
                "text": "",
                "color": "#ececec",
            }]
        };

        const sendMessageOptions = {
            "url": "https://api.watsonwork.ibm.com/v1/spaces/${space_id}/messages",
            "headers": {
                "Content-Type": "application/json",
                "jwt": ""
            },
            "method": "POST",
            "body": ""
        };

        sendMessageOptions.url = sendMessageOptions.url.replace("${space_id}", spaceId);
        sendMessageOptions.headers.jwt = accessToken;
        appMessage.annotations[0].title = msgTitle;
        appMessage.annotations[0].text = msgText;
        sendMessageOptions.body = JSON.stringify(appMessage);

        request(sendMessageOptions, function(err, response, sendMessageBody) {

          if (err || response.statusCode !== 201) {
              console.log("ERROR: Posting to " + sendMessageOptions.url + "resulted on http status code: " + response.statusCode + " and error " + err);
          }

        });
      }
      else {
        console.log("INFO: Skipping sending a message of analysis of our own message " + JSON.stringify(body));
      }
    });
  });
}







