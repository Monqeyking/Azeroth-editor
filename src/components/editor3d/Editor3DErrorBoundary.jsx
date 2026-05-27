import { Component } from 'react';

export default class Editor3DErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="editor3d-error">
          <h3>3D renderer crash</h3>
          <pre>{this.state.error.message}</pre>
          <button onClick={() => this.setState({ error: null })}>Opnieuw proberen</button>
        </div>
      );
    }
    return this.props.children;
  }
}
