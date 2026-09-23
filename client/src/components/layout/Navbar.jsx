import { ArrowRight, Wifi } from "lucide-react";
import { Link } from "react-router-dom";
import { makeRoomId } from "../../utils/auth";
export default function Navbar({ auth }) {
  return <nav className="nav"><Link to="/" className="brand"><span className="brand-mark"><Wifi size={18} /></span><span>Sync<span>Space</span></span></Link><div className="nav-links"><a href="#features">Features</a><a href="#security">Security</a><a href="#workflow">How it works</a></div><div className="nav-actions">{auth ? <Link className="btn btn-primary btn-sm" to={`/room/${makeRoomId()}`}>Open workspace <ArrowRight size={15} /></Link> : <><Link className="btn btn-ghost btn-sm" to="/login">Sign in</Link><Link className="btn btn-primary btn-sm" to="/register">Get started</Link></>}</div></nav>;
}
