const MONEY_GAME = /\b(jpmorgan|goldman sachs|morgan stanley|bank of america|citigroup|barclays|deutsche bank|ubs|wells fargo|blackrock|vanguard|fidelity|bridgewater|citadel|two sigma|renaissance technologies|aqr|point72|millennium|d\.e\. shaw|blackstone|kkr|carlyle|apollo|bain capital|tpg|warburg pincus|general atlantic|temasek|gic|adia|mubadala|pif|khazanah|cppib|calpers|warren buffett|charlie munger|ray dalio|jamie dimon|larry fink|cathie wood|michael burry|bill ackman|george soros|stanley druckenmiller|coinbase|binance|bitcoin|ethereum|solana|stablecoin|tether|usdc|spot etf|federal reserve|fomc|ecb|imf|world bank|cpi|inflation|interest rates|basis points|yield curve|moody|fitch|s&p 500|nasdaq|dow jones|treasury|bond market|credit default|ipo|spac|secondary offering|lockup expiry|earnings|revenue|profit margin|ebitda|free cash flow|ambani|mukesh ambani|adani|gautam adani|reliance industries|reliance jio|tata|mahindra|bajaj|wipro|infosys|tcs|hdfc|icici|sbi|kotak|axis bank|paytm|zerodha|sebi|rbi|reserve bank of india|nifty|sensex|bse|nse|softbank|masayoshi son|vision fund|alibaba|tencent|ant group|jack ma|ping an|citic|icbc|bank of china|dbs|ocbc|uob|grab|gojek|sea limited|samsung|hyundai|lg|sk hynix|posco|kakao|naver|petronas|maybank|cimb|sovereign wealth|saudi|uae|qatar|abu dhabi)\b/i

const HUMAN_MIND = /\b(study|research|paper|published|peer[- ]reviewed|meta[- ]analysis|clinical trial|neuroscience|cognitive|behavioral|psychology|psychiatry|dopamine|serotonin|cortisol|neuroplasticity|prefrontal cortex|amygdala|habit|addiction|motivation|willpower|procrastination|anxiety|depression|burnout|sleep|circadian|rem|deep sleep|sleep deprivation|therapy|cbt|meditation|mindfulness|journaling|bias|heuristic|mental model|first principles|decision making|stanford|harvard|mit|nature|lancet|nejm|pubmed|ayurveda|yoga|pranayama|vedanta|iit|iim|aiims|collectivist|individualist|eastern psychology|confucian|gut microbiome|fasting|intermittent fasting|circadian fasting)\b/i

const HOW_COMPANIES_WIN = /\b(apple|microsoft|google|alphabet|amazon|meta|tesla|nvidia|netflix|spotify|uber|airbnb|salesforce|oracle|sap|openai|anthropic|mistral|perplexity|cursor|notion|linear|figma|stripe|vercel|supabase|market share|competitive moat|network effects|switching costs|pricing power|unit economics|churn|retention|nps|product[- ]market fit|go[- ]to[- ]market|distribution|channel|merger|acquisition|acquihire|hostile takeover|antitrust|market cap|valuation|layoffs|restructuring|pivot|shutdown|bankruptcy|chapter 11|ceo|cto|cfo|board|founder|cofounder|executive|leadership|arr|mrr|burn rate|runway|series [a-d]|seed|pre[- ]seed|bridge round|down round|yc|y combinator|techstars|sequoia|a16z|andreessen|accel|benchmark|founders fund|flipkart|meesho|zepto|blinkit|swiggy|zomato|ola|rapido|phonepe|razorpay|freshworks|zoho|byju|unacademy|vedantu|cred|groww|xiaomi|bytedance|tiktok|shein|pinduoduo|meituan|didi|baidu|jd\.com|tokopedia|shopee|goto|nykaa|mamaearth|boat|indian startup|indian unicorn|desi|chaebol|chaebols|samsung group|lg group|sk group|lotte|hyundai group)\b/i

const WHATS_COMING = /\b(ai|artificial intelligence|machine learning|llm|large language model|foundation model|semiconductor|chip|nvidia|tsmc|asml|intel|amd|arm|quantum computing|quantum|qubit|biotech|crispr|gene editing|longevity|aging|geroprotector|ozempic|glp[- ]1|nuclear|fusion|fission|small modular reactor|smr|climate|carbon|net zero|carbon capture|ccs|solar|wind|battery|grid storage|geopolitics|war|military|escalation|missile|strike|airstrike|proxy|proxies|militia|militias|naval|shipping|hormuz|strait of hormuz|red sea|gulf|persian gulf|iran|iranian|tehran|israel|israeli|china|taiwan|us[- ]china|u\.s\.[- ]china|election|regulation|policy|tariff|sanction|export controls?|space|spacex|rocket|satellite|starlink|lunar|mars|robotics|automation|humanoid|boston dynamics|figure|blockchain|defi|web3|dao|tokenization|paradigm shift|technological revolution|s[- ]curve|adoption curve|tipping point|supply chain|reshoring|nearshoring|india|indian|pakistan|bangladesh|southeast asia|asean|chinese|beijing|shanghai|xi jinping|taiwan strait|middle east|gcc|saudi vision 2030|uae|dubai|belt and road|bri|rupee|yuan|renminbi|de-dollarization|brics|semiconductor india|chip india|pli scheme|digital india|upi|india stack|aadhaar|isro|chandrayaan|gaganyaan|indonesia|vietnam|philippines|malaysia|thailand|manufacturing shift|china plus one|friend shoring|green hydrogen|clean energy|renewable|renewables)\b/i

const THINK_SHARPER = /\b(mental model|first principles|inversion|second[- ]order|systems thinking|feedback loop|charlie munger|nassim taleb|daniel kahneman|richard feynman|elon musk|naval ravikant|cognitive bias|confirmation bias|survivorship bias|availability heuristic|anchoring|logic|reasoning|argument|fallacy|socratic|decision making|probabilistic|bayesian|expected value|risk|uncertainty|asymmetric|framework|hypothesis|falsifiable|experiment|null hypothesis|complexity|emergence|chaos theory|black swan|fat tail|antifragile|philosophy|stoicism|epistemology|rationalism|empiricism|reading|books|learning|memory|retention|spaced repetition|feynman technique|iq|intelligence|wisdom|judgment|clarity|focus|deep work|flow state|chanakya|arthashastra|sun tzu|art of war|confucius|confucian|taoism|lao tzu|zen|jugaad|frugal innovation|vedic mathematics|munger|poor charlie|ramayana|mahabharata|bhagavad gita|karma|dharma)\b/i

const MOVE_PEOPLE = /\b(negotiation|persuasion|influence|rhetoric|storytelling|narrative|framing|positioning|sales|closing|objection handling|cold outreach|cold email|pipeline|marketing|copywriting|headline|hook|cta|conversion|funnel|public speaking|presentation|pitch|investor pitch|demo day|leadership|management|hiring|firing|performance review|feedback|culture|team|morale|conflict|trust|psychological safety|social media|viral|content|personal brand|audience|newsletter|pr|press|media|journalist|traction|credibility|body language|tonality|eye contact|charisma|cialdini|dale carnegie|chris voss|andy grove|ben horowitz|jugaad|cricket|ipl|bcci|family business|patriarch|hierarchy|high context|low context|cultural intelligence)\b/i

const LIVE_SEARCH_DOMAINS = [
  MONEY_GAME,
  HUMAN_MIND,
  HOW_COMPANIES_WIN,
  WHATS_COMING,
  THINK_SHARPER,
  MOVE_PEOPLE,
]

export function isFreshnessAsk(text = '') {
  return /\b(now|today|current|currently|latest|recent|recently|this week|this month|this year|live|news|update|updates|what happened|what (?:is|are) .* doing|what has .* done|how is .* moving)\b/i.test(text)
}

export function isForecastAsk(text = '') {
  return /\b(signal|signals|forecast|prediction|predict|next \d+|next \d+-\d+ years?|next decade|202[7-9]|2030|2035|future effects?|what'?s coming)\b/i.test(text)
}

export function isLiveSearchDomain(text = '') {
  return LIVE_SEARCH_DOMAINS.some((pattern) => pattern.test(text))
}

export function wantsLiveSearchForText(text = '') {
  return (isFreshnessAsk(text) || isForecastAsk(text)) && isLiveSearchDomain(text)
}

export function isCurrentFactualLiveQuestion(text = '') {
  return isFreshnessAsk(text) && isLiveSearchDomain(text)
}
