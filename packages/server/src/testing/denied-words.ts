/**
 * The Denied_List (brief 054, "The persona: taste rules"; spec kiroween-demo, Requirement 25.2 and the Taste
 * properties). Words and phrases no line of the Kisses persona may hold, so the persona names no real company, brand,
 * product, place of business or person. Invented only.
 *
 * It is kept broad on purpose: large companies and brands, and well-known public figures in general, so it reads as
 * a general rule and not as a list about one person. It is data. Add to it freely; never remove an entry to make a
 * persona pass.
 *
 * Form. Every entry is already folded: lower case, letters and digits, one space between words, no punctuation
 * (the scanner folds text the same way, so "McDonald's" is `mcdonald s` and "Chick-fil-A" is `chick fil a`). A
 * phrase matches whole words in sequence. A single word matches that whole word only, never part of a longer one.
 *
 * Left off on purpose: words that are also plain English and would flag ordinary writing (apple, target, gap,
 * shell, square, oracle, delta, subway, coke, meta, intel, zoom, slack, stripe, visa, ford, drake, madonna). Their
 * brand sense is still denied: the persona-author skill and the kisses-taste steering file say to pick another word.
 * Full names are listed for people whose surname is also a common word (gates, jobs, cook, page, king, ford).
 *
 * Two readers keep to this shape: `packages/server/src/demo/taste-scan.ts` imports `DENIED_WORDS`, and
 * `.kiro/skills/persona-author/scripts/check.mjs` reads the quoted strings between the brackets below without
 * running TypeScript. Keep the array a plain list of double-quoted strings, one or more per line, with `//`
 * comment lines between groups, and keep the array literal as the only code in this file.
 */
export const DENIED_WORDS: readonly string[] = [
  // Technology and internet
  "google", "alphabet inc", "microsoft", "facebook", "instagram", "whatsapp", "twitter", "tiktok", "snapchat",
  "youtube", "netflix", "spotify", "openai", "chatgpt", "anthropic", "nvidia", "qualcomm", "samsung", "huawei",
  "xiaomi", "lenovo", "sony", "toshiba", "panasonic", "philips", "siemens", "bosch", "ibm", "salesforce", "adobe",
  "photoshop", "dropbox", "paypal", "venmo", "cash app", "zelle", "linkedin", "reddit", "pinterest", "wikipedia",
  "iphone", "ipad", "macbook", "apple watch", "airpods", "android", "xbox", "playstation", "nintendo", "game boy",
  "fitbit", "gopro", "garmin", "uber", "uber eats", "lyft", "doordash", "grubhub",
  "instacart", "airbnb", "expedia", "tripadvisor", "yelp", "craigslist", "ebay", "etsy", "alibaba", "amazon",
  "walmart", "aliexpress", "shopify",

  // Space, aviation and defence
  "spacex", "blue origin", "virgin galactic", "nasa", "boeing", "lockheed martin", "lockheed", "northrop grumman",
  "raytheon", "rocket lab", "united launch alliance", "airbus", "rolls royce", "general electric", "honeywell",
  "delta air lines", "american airlines", "united airlines", "jetblue", "british airways", "lufthansa", "air france",
  "qantas", "ryanair", "easyjet", "fedex", "ups store", "dhl", "maersk",

  // Banks, cards, money
  "mastercard", "american express", "amex", "capital one", "wells fargo", "jpmorgan", "jp morgan", "chase bank",
  "goldman sachs", "morgan stanley", "citibank", "citigroup", "bank of america", "hsbc", "barclays", "credit suisse",
  "deutsche bank", "ubs", "fidelity investments", "vanguard group", "blackrock", "charles schwab", "robinhood", "coinbase", "binance",
  "western union", "moneygram", "experian", "equifax", "transunion", "turbotax", "quickbooks",

  // Retail, grocery and restaurants
  "costco", "whole foods", "trader joe", "kroger", "safeway", "publix", "aldi", "lidl", "tesco", "home depot",
  "lowe s", "ikea", "best buy", "old navy", "nordstrom", "macy s", "kmart", "7 eleven", "seven eleven",
  "dollar general", "family dollar", "rite aid", "cvs", "walgreens", "petco", "petsmart", "uniqlo", "zara", "h and m",
  "mcdonald s", "burger king", "wendy s", "kfc", "taco bell", "starbucks", "dunkin", "chipotle", "domino s",
  "pizza hut", "papa john s", "panera", "chick fil a", "in n out", "five guys", "shake shack", "krispy kreme",
  "tim hortons", "pret a manger", "nando s", "big mac", "whopper",

  // Food and drink brands
  "coca cola", "pepsi", "red bull", "gatorade", "dr pepper", "fanta", "nestle", "kraft", "heinz",
  "kellogg", "oreo", "doritos", "pringles", "cheetos", "snickers", "kit kat", "nutella", "tabasco", "budweiser",
  "heineken", "guinness", "corona beer", "jack daniel s", "jim beam", "smirnoff", "grey goose", "hennessy",

  // Cars and travel
  "general motors", "ford motor", "toyota", "honda", "volkswagen", "bmw", "mercedes benz", "porsche", "ferrari",
  "lamborghini", "bentley", "land rover", "range rover", "maserati", "bugatti", "mclaren", "aston martin", "audi",
  "volvo", "nissan", "subaru", "mazda", "hyundai", "kia motors", "lexus", "acura", "tesla", "harley davidson",
  "hertz rent a car", "avis rent a car", "enterprise rent a car", "marriott", "hilton hotels", "hyatt", "four seasons", "ritz carlton",
  "holiday inn", "sheraton", "best western", "carnival cruise", "royal caribbean",

  // Clothing, luxury and consumer goods
  "nike", "adidas", "under armour", "new balance", "gucci", "prada", "chanel", "hermes", "louis vuitton",
  "burberry", "versace", "armani", "dior", "tiffany and co", "cartier", "rolex", "omega watch", "ray ban",
  "lululemon", "patagonia", "north face", "timberland boots", "converse shoes", "crocs", "birkenstock", "tupperware", "sharpie",
  "kleenex", "band aid", "post it", "velcro", "q tip", "jacuzzi", "xerox", "ziploc", "tylenol", "advil", "pfizer",
  "moderna", "johnson and johnson", "colgate", "gillette", "dove soap", "lego", "barbie", "hot wheels", "play doh",

  // Entertainment, characters and media
  "disney", "pixar", "marvel", "dc comics", "star wars", "star trek", "harry potter", "lord of the rings",
  "game of thrones", "hello kitty", "pokemon", "minecraft", "fortnite", "mario kart", "super mario", "legend of zelda",
  "hbo", "espn", "nbc", "cbs", "abc news", "cnn", "fox news", "msnbc", "bbc", "new york times", "washington post",
  "wall street journal", "forbes", "bloomberg", "reuters", "associated press", "time magazine", "vogue magazine",
  "rolling stone", "grammy", "oscar awards", "emmy awards", "super bowl", "fifa", "nfl",
  "nba", "mlb", "nhl", "premier league", "formula one",

  // Technology and business figures
  "elon musk", "jeff bezos", "bill gates", "steve jobs", "tim cook", "mark zuckerberg", "sundar pichai",
  "satya nadella", "jensen huang", "larry page", "sergey brin", "larry ellison", "warren buffett", "charlie munger",
  "jamie dimon", "richard branson", "sam altman", "peter thiel", "jack dorsey", "bernard arnault",
  "michael bloomberg", "mark cuban", "steve wozniak", "zuckerberg", "bezos", "buffett", "henry ford",
  "thomas edison", "nikola tesla",

  // Politicians and world leaders
  "donald trump", "joe biden", "barack obama", "hillary clinton", "bill clinton", "george bush", "ronald reagan",
  "kamala harris", "mike pence", "nancy pelosi", "bernie sanders", "vladimir putin", "xi jinping", "angela merkel",
  "emmanuel macron", "boris johnson", "justin trudeau", "narendra modi", "kim jong un", "pope francis",
  "queen elizabeth", "king charles", "prince william", "prince harry", "meghan markle", "kate middleton",
  "winston churchill", "abraham lincoln", "napoleon bonaparte", "nelson mandela", "mahatma gandhi",
  "martin luther king", "mother teresa", "dalai lama", "greta thunberg", "malala yousafzai",

  // Musicians
  "taylor swift", "beyonce", "rihanna", "kanye west", "kim kardashian", "kardashian", "jay z", "bruno mars",
  "ed sheeran", "lady gaga", "justin bieber", "ariana grande", "katy perry", "billie eilish",
  "harry styles", "the weeknd", "elvis presley", "michael jackson", "john lennon", "paul mccartney", "bob dylan",
  "freddie mercury", "david bowie", "prince rogers nelson", "bruce springsteen", "dolly parton", "johnny cash",
  "frank sinatra", "louis armstrong", "mozart", "beethoven", "metallica", "coldplay", "u2", "the beatles",
  "rolling stones", "led zeppelin", "pink floyd",

  // Actors, directors and writers
  "oprah winfrey", "oprah", "tom hanks", "brad pitt", "angelina jolie", "leonardo dicaprio", "johnny depp",
  "will smith", "dwayne johnson", "tom cruise", "robert downey", "keanu reeves", "jennifer lawrence",
  "scarlett johansson", "meryl streep", "morgan freeman", "denzel washington", "harrison ford", "arnold schwarzenegger",
  "clint eastwood", "samuel l jackson", "robert de niro", "al pacino", "marilyn monroe", "audrey hepburn",
  "charlie chaplin", "steven spielberg", "george lucas", "christopher nolan", "quentin tarantino", "martin scorsese",
  "alfred hitchcock", "stanley kubrick", "walt disney", "stephen king", "j k rowling", "jk rowling", "dan brown",
  "ernest hemingway", "mark twain", "william shakespeare", "charles dickens", "jane austen", "agatha christie",
  "george orwell", "tolkien", "leo tolstoy",

  // Sport
  "lionel messi", "messi", "cristiano ronaldo", "ronaldo", "neymar", "lebron james", "michael jordan",
  "kobe bryant", "stephen curry", "tom brady", "patrick mahomes", "serena williams", "roger federer",
  "rafael nadal", "novak djokovic", "usain bolt", "tiger woods", "muhammad ali", "simone biles", "michael phelps",
  "wayne gretzky", "babe ruth", "diego maradona", "david beckham", "lewis hamilton", "max verstappen",
  "michael schumacher", "ayrton senna",

  // Science, exploration and presenters
  "neil armstrong", "buzz aldrin", "yuri gagarin", "sally ride", "albert einstein", "isaac newton", "stephen hawking",
  "marie curie", "charles darwin", "galileo", "carl sagan", "jane goodall", "david attenborough",
  "neil degrasse tyson", "bill nye", "leonardo da vinci", "pablo picasso", "vincent van gogh", "salvador dali",
  "andy warhol", "banksy", "frida kahlo",

  // Creators, hosts and comedians
  "mr beast", "mrbeast", "pewdiepie", "joe rogan", "howard stern", "jimmy fallon", "stephen colbert",
  "jon stewart", "ellen degeneres", "conan o brien", "trevor noah", "dave chappelle", "jimmy kimmel",
  "john oliver", "jerry seinfeld", "robin williams", "gordon ramsay", "martha stewart", "anthony bourdain",
];
