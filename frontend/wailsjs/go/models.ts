export namespace search {
	
	export class Country {
	    code: string;
	    name: string;
	    flag: string;
	    lang: string;
	    tz: string;
	    lat: number;
	    lng: number;
	    locale: string;
	
	    static createFrom(source: any = {}) {
	        return new Country(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.code = source["code"];
	        this.name = source["name"];
	        this.flag = source["flag"];
	        this.lang = source["lang"];
	        this.tz = source["tz"];
	        this.lat = source["lat"];
	        this.lng = source["lng"];
	        this.locale = source["locale"];
	    }
	}
	export class Result {
	    url: string;
	    title: string;
	    snippet: string;
	    source: string;
	
	    static createFrom(source: any = {}) {
	        return new Result(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.url = source["url"];
	        this.title = source["title"];
	        this.snippet = source["snippet"];
	        this.source = source["source"];
	    }
	}
	export class Results {
	    web: Result[];
	    onion: Result[];
	    torrent: Result[];
	    query: string;
	    page: number;
	    hasMore: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Results(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.web = this.convertValues(source["web"], Result);
	        this.onion = this.convertValues(source["onion"], Result);
	        this.torrent = this.convertValues(source["torrent"], Result);
	        this.query = source["query"];
	        this.page = source["page"];
	        this.hasMore = source["hasMore"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

